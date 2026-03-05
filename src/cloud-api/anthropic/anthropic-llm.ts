import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import moment from "moment";
import { isEmpty } from "lodash";
import {
  shouldResetChatHistory,
  systemPrompt,
  updateLastMessageTime,
} from "../../config/llm-config";
import { llmTools, llmFuncMap } from "../../config/llm-tools";
import dotenv from "dotenv";
import { FunctionCall, Message, ToolReturnTag } from "../../type";
import {
  ChatWithLLMStreamFunction,
  SummaryTextWithLLMFunction,
} from "../interface";
import { chatHistoryDir } from "../../utils/dir";
import {
  extractToolResponse,
  stimulateStreamResponse,
} from "../../config/common";
import { proxyFetch } from "../proxy-fetch";

dotenv.config();

const anthropicApiKey = process.env.ANTHROPIC_API_KEY || "";
const anthropicModel =
  process.env.ANTHROPIC_LLM_MODEL || "claude-opus-4-5";
const anthropicMaxTokens = parseInt(
  process.env.ANTHROPIC_MAX_TOKENS || "8096",
  10,
);
const anthropicEnableTools =
  (process.env.ANTHROPIC_ENABLE_TOOLS || "true").toLowerCase() === "true";
const anthropicEnableThinking =
  (process.env.ENABLE_THINKING || "false").toLowerCase() === "true";

const client = anthropicApiKey
  ? new Anthropic({ apiKey: anthropicApiKey, fetch: proxyFetch as any })
  : null;

const chatHistoryFileName = `anthropic_chat_history_${moment().format(
  "YYYY-MM-DD_HH-mm-ss",
)}.json`;

const messages: Message[] = [
  {
    role: "system",
    content: systemPrompt,
  },
];

const resetChatHistory = (): void => {
  messages.length = 0;
  messages.push({
    role: "system",
    content: systemPrompt,
  });
};

/**
 * Convert internal Message[] to Anthropic API messages format.
 * - Extracts the system prompt (first system message).
 * - Converts tool-result messages to the Anthropic user content block format.
 */
const toAnthropicMessages = (
  msgs: Message[],
): Anthropic.MessageParam[] => {
  const result: Anthropic.MessageParam[] = [];

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];

    if (msg.role === "system") {
      // System messages are passed separately; skip here.
      continue;
    }

    if (msg.role === "tool") {
      // Anthropic expects tool results as a user message with tool_result content blocks.
      // Group consecutive tool messages into a single user message.
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      let j = i;
      while (j < msgs.length && msgs[j].role === "tool") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: msgs[j].tool_call_id || "",
          content: msgs[j].content,
        });
        j++;
      }
      result.push({ role: "user", content: toolResults });
      i = j - 1; // skip processed tool messages
      continue;
    }

    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      // Assistant message has both text and tool_use blocks.
      const content: Anthropic.ContentBlockParam[] = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      for (const call of msg.tool_calls) {
        let parsedInput: Record<string, any> = {};
        try {
          parsedInput = JSON.parse(call.function.arguments || "{}");
        } catch {
          // ignore
        }
        content.push({
          type: "tool_use",
          id: call.id || `toolu_${Math.random().toString(36).slice(2)}`,
          name: call.function.name || "",
          input: parsedInput,
        });
      }
      result.push({ role: "assistant", content });
      continue;
    }

    result.push({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    });
  }

  return result;
};

/**
 * Convert internal LLMTool[] to Anthropic tool format.
 */
const toAnthropicTools = (): Anthropic.Tool[] => {
  return llmTools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: {
      type: "object" as const,
      properties: tool.function.parameters.properties || {},
      required: tool.function.parameters.required || [],
    },
  }));
};

const chatWithLLMStream: ChatWithLLMStreamFunction = async (
  inputMessages: Message[] = [],
  partialCallback: (partialAnswer: string) => void,
  endCallback: () => void,
  partialThinkingCallback?: (partialThinking: string) => void,
  invokeFunctionCallback?: (functionName: string, result?: string) => void,
): Promise<void> => {
  if (!client) {
    console.error("Anthropic API key is not set.");
    return;
  }
  if (shouldResetChatHistory()) {
    resetChatHistory();
  }
  updateLastMessageTime();
  messages.push(...inputMessages);

  let endResolve: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    endResolve = resolve;
  }).finally(() => {
    fs.writeFileSync(
      path.join(chatHistoryDir, chatHistoryFileName),
      JSON.stringify(messages, null, 2),
    );
  });

  try {
    // Extract system prompt (first system message wins)
    const systemMsg =
      messages.find((m) => m.role === "system")?.content || systemPrompt;
    const anthropicMessages = toAnthropicMessages(messages);
    const anthropicTools = anthropicEnableTools ? toAnthropicTools() : undefined;

    const requestParams: Anthropic.MessageCreateParamsStreaming = {
      model: anthropicModel,
      max_tokens: anthropicMaxTokens,
      system: systemMsg,
      messages: anthropicMessages,
      stream: true,
      ...(anthropicTools && anthropicTools.length > 0
        ? { tools: anthropicTools }
        : {}),
      ...(anthropicEnableThinking
        ? {
            thinking: {
              type: "enabled" as const,
              budget_tokens: Math.floor(anthropicMaxTokens * 0.8),
            },
          }
        : {}),
    };

    const stream = await client.messages.create(requestParams);

    let partialAnswer = "";
    let currentToolUseId = "";
    let currentToolUseName = "";
    let currentToolInputJson = "";
    const toolCalls: FunctionCall[] = [];
    let blockIndex = -1;
    let blockType = "";

    for await (const event of stream as AsyncIterable<Anthropic.MessageStreamEvent>) {
      if (event.type === "content_block_start") {
        blockIndex = (event as any).index;
        blockType = event.content_block.type;
        if (blockType === "tool_use") {
          currentToolUseId = (event.content_block as Anthropic.ToolUseBlock).id;
          currentToolUseName = (event.content_block as Anthropic.ToolUseBlock).name;
          currentToolInputJson = "";
        }
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          partialCallback(delta.text);
          partialAnswer += delta.text;
        } else if (delta.type === "thinking_delta") {
          partialThinkingCallback?.(delta.thinking);
        } else if (delta.type === "input_json_delta") {
          currentToolInputJson += delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (blockType === "tool_use" && currentToolUseName) {
          toolCalls.push({
            id: currentToolUseId,
            index: toolCalls.length,
            type: "function",
            function: {
              name: currentToolUseName,
              arguments: currentToolInputJson,
            },
          });
          currentToolUseName = "";
          currentToolInputJson = "";
        }
      } else if (event.type === "message_stop") {
        // Stream complete
      }
    }

    // Push assistant message with tool_calls if any
    messages.push({
      role: "assistant",
      content: partialAnswer,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    if (!isEmpty(toolCalls)) {
      const results = await Promise.all(
        toolCalls.map(async (call: FunctionCall) => {
          const {
            function: { arguments: argString, name },
            id,
          } = call;
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(argString || "{}");
          } catch {
            console.error(
              `Error parsing arguments for function ${name}:`,
              argString,
            );
          }
          const func = llmFuncMap[name! as string];
          invokeFunctionCallback?.(name! as string);
          if (func) {
            return [
              id,
              name,
              await func(args)
                .then((res) => {
                  invokeFunctionCallback?.(name! as string, res);
                  return res;
                })
                .catch((err) => {
                  console.error(`Error executing function ${name}:`, err);
                  return `Error executing function ${name}: ${err.message}`;
                }),
            ];
          } else {
            console.error(`Function ${name} not found`);
            return [id, name, `Function ${name} not found`];
          }
        }),
      );

      const newMessages: Message[] = results.map(([id, _name, result]: any) => ({
        role: "tool" as const,
        content: result as string,
        tool_call_id: id as string,
      }));

      // Directly return if a tool provides a direct response
      const describeMessage = newMessages.find((msg) =>
        msg.content.startsWith(ToolReturnTag.Response),
      );
      const responseContent = extractToolResponse(
        describeMessage?.content || "",
      );
      if (responseContent) {
        console.log(
          `[LLM] Tool response starts with "[response]", return it directly.`,
        );
        newMessages.push({
          role: "assistant",
          content: responseContent,
        });
        await stimulateStreamResponse({
          content: responseContent,
          partialCallback,
          endResolve,
          endCallback,
        });
        return;
      }

      await chatWithLLMStream(newMessages, partialCallback, () => {
        endResolve();
        endCallback();
      });
      return;
    } else {
      endResolve();
      endCallback();
    }
  } catch (error: any) {
    console.error("Anthropic LLM error:", error.message);
    endResolve();
    endCallback();
  }

  return promise;
};

const summaryTextWithLLM: SummaryTextWithLLMFunction = async (
  text: string,
  promptPrefix: string,
): Promise<string> => {
  if (!client) {
    console.error("Anthropic API key is not set. Using original text.");
    return text;
  }
  try {
    const response = await client.messages.create({
      model: anthropicModel,
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `${promptPrefix}\n\n${text}\n\n`,
        },
      ],
    });
    const summary =
      response.content
        .filter((block) => block.type === "text")
        .map((block) => (block as Anthropic.TextBlock).text)
        .join("") || "";
    if (summary) {
      console.log("Anthropic summary:", summary);
      return summary;
    }
  } catch (error: any) {
    console.error("Error during Anthropic summary request:", error.message);
  }
  return text;
};

export default { chatWithLLMStream, resetChatHistory, summaryTextWithLLM };
