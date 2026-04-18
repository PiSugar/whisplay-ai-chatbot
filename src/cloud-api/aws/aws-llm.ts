import fs from "fs";
import path from "path";
import moment from "moment";
import { isEmpty } from "lodash";
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  Message as BedrockMessage,
  Tool,
  ToolConfiguration
} from "@aws-sdk/client-bedrock-runtime";
import type { ConverseStreamCommandInput, SystemContentBlock } from "@aws-sdk/client-bedrock-runtime";
import { shouldResetChatHistory, systemPrompt, updateLastMessageTime } from "../../config/llm-config";
import { llmTools, llmFuncMap } from "../../config/llm-tools";
import { FunctionCall, Message, ToolReturnTag } from "../../type";
import { ChatWithLLMStreamFunction, SummaryTextWithLLMFunction } from "../interface";
import { chatHistoryDir } from "../../utils/dir";
import { extractToolResponse, stimulateStreamResponse } from "../../config/common";
import { AWS_REGION, getAwsCredentials, hasAwsCredentials, awsBedrockModel } from "./aws";
import {
  consumePendingCapturedImgForChat,
  hasPendingCapturedImgForChat,
  getImageMimeType,
} from "../../utils/image";

const useCapturedImageInChat =
  (process.env.USE_CAPTURED_IMAGE_IN_CHAT || "false").toLowerCase() === "true";

const client = hasAwsCredentials()
  ? new BedrockRuntimeClient({ region: AWS_REGION, credentials: getAwsCredentials() })
  : null;

const chatHistoryFileName = `aws_chat_history_${moment().format("YYYY-MM-DD_HH-mm-ss")}.json`;

const messages: Message[] = [
  { role: "system", content: systemPrompt },
];

const resetChatHistory = (): void => {
  messages.length = 0;
  messages.push({ role: "system", content: systemPrompt });
};

const toBedrockMessages = (
  msgs: Message[],
  capturedImagePath?: string,
  lastUserMsgIdx?: number
): BedrockMessage[] => {
  const result: BedrockMessage[] = [];

  let imageBlock: any = null;
  if (capturedImagePath) {
    try {
      const mimeType = getImageMimeType(capturedImagePath);
      const formatStr = mimeType?.split("/")[1] || "jpeg";
      const format = formatStr === "jpg" ? "jpeg" : formatStr;
      const imageBytes = fs.readFileSync(capturedImagePath);
      imageBlock = {
        image: {
          format,
          source: { bytes: new Uint8Array(imageBytes) },
        }
      };
    } catch (err) {
      console.error("Error reading captured image:", err);
    }
  }

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    if (msg.role === "system") continue;

    if (msg.role === "tool") {
      const contentBlocks: any[] = [];
      while (i < msgs.length && msgs[i].role === "tool") {
        contentBlocks.push({
          toolResult: {
            toolUseId: msgs[i].tool_call_id || "",
            content: [{ text: msgs[i].content }],
            status: "success",
          }
        });
        i++;
      }
      i--;
      result.push({ role: "user", content: contentBlocks });
      continue;
    }

    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const contentBlocks: any[] = [];
      if (msg.content) {
        contentBlocks.push({ text: msg.content });
      }
      for (const call of msg.tool_calls) {
        let parsedInput: any = {};
        try { parsedInput = JSON.parse(call.function.arguments || "{}"); } catch { }
        contentBlocks.push({
          toolUse: {
            toolUseId: call.id || `tool_${Date.now()}`,
            name: call.function.name || "",
            input: parsedInput,
          }
        });
      }
      result.push({ role: "assistant", content: contentBlocks });
      continue;
    }

    if (!msg.content) {
      continue;
    }

    const contentBlocks: any[] = [{ text: msg.content }];
    if (imageBlock && msg.role === "user" && i === lastUserMsgIdx) {
      contentBlocks.push(imageBlock);
    }

    result.push({
      role: msg.role as "user" | "assistant",
      content: contentBlocks
    });
  }
  return result;
};

const toBedrockTools = (): ToolConfiguration | undefined => {
  if (llmTools.length === 0) return undefined;

  const tools: Tool[] = llmTools.map(tool => ({
    toolSpec: {
      name: tool.function.name,
      description: tool.function.description,
      inputSchema: {
        json: {
          type: "object",
          properties: tool.function.parameters.properties || {},
          required: tool.function.parameters.required || [],
        }
      }
    }
  }));
  return { tools };
};

const chatWithLLMStream: ChatWithLLMStreamFunction = async (
  inputMessages: Message[] = [],
  partialCallback: (partialAnswer: string) => void,
  endCallback: () => void,
  partialThinkingCallback?: (partialThinking: string) => void,
  invokeFunctionCallback?: (functionName: string, result?: string) => void
): Promise<void> => {
  if (!client) {
    console.error("AWS credentials are not set.");
    return;
  }

  if (shouldResetChatHistory()) {
    resetChatHistory();
  }

  updateLastMessageTime();
  messages.push(...inputMessages);

  let endResolve: () => void = () => { };
  const promise = new Promise<void>((resolve) => { endResolve = resolve; }).finally(() => {
    fs.writeFileSync(path.join(chatHistoryDir, chatHistoryFileName), JSON.stringify(messages, null, 2));
  });

  try {
    const systemMsgs: SystemContentBlock[] = messages.reduce((acc, m) => m.role === "system" ? [...acc, { text: m.content }] : acc, [] as SystemContentBlock[]);
    if (systemMsgs.length === 0) {
      systemMsgs.push({ text: systemPrompt });
    }

    const lastUserMessageIndex = messages
      .map((msg, index) => ({ msg, index }))
      .filter(({ msg }) => msg.role === "user")
      .map(({ index }) => index)
      .pop();

    const capturedImagePath =
      useCapturedImageInChat && lastUserMessageIndex !== undefined && hasPendingCapturedImgForChat()
        ? consumePendingCapturedImgForChat()
        : "";

    const bedrockMessages = toBedrockMessages(messages, capturedImagePath, lastUserMessageIndex);
    const toolConfig = toBedrockTools();

    let commandParam: ConverseStreamCommandInput = {
      modelId: awsBedrockModel,
      system: systemMsgs,
      messages: bedrockMessages,
    };

    if (toolConfig) {
      commandParam.toolConfig = toolConfig;
    }

    const command = new ConverseStreamCommand(commandParam);
    const response = await client.send(command);

    let partialAnswer = "";
    const toolCalls: FunctionCall[] = [];

    if (response.stream) {
      for await (const chunk of response.stream) {
        if (chunk.contentBlockStart) {
          const scbs = chunk.contentBlockStart;
          if (scbs.start?.toolUse) {
            toolCalls.push({
              id: scbs.start.toolUse.toolUseId || "sys_" + Date.now(),
              index: toolCalls.length,
              type: "function",
              function: {
                name: scbs.start.toolUse.name || "",
                arguments: ""
              }
            });
          }
        } else if (chunk.contentBlockDelta) {
          const d = chunk.contentBlockDelta;
          if (d.delta?.text) {
            partialAnswer += d.delta.text;
            partialCallback(d.delta.text);
          }
          if (d.delta?.toolUse) {
            toolCalls[toolCalls.length - 1].function.arguments += d.delta.toolUse.input || "";
          }
        }

      }
    }

    messages.push({
      role: "assistant",
      content: partialAnswer,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    if (!isEmpty(toolCalls)) {
      const results = await Promise.all(
        toolCalls.map(async (call: FunctionCall) => {
          const { function: { arguments: argString, name }, id } = call;
          console.log('func call', JSON.stringify(call, null, 2))

          let args: Record<string, any> = {};
          try { args = JSON.parse(argString || "{}"); } catch { }
          const func = llmFuncMap[name! as string];
          invokeFunctionCallback?.(name! as string);

          if (func) {
            try {
              const res = await func(args);
              invokeFunctionCallback?.(name! as string, res);
              return [id, name, res];
            } catch (err: any) {
              return [id, name, `Error: ${err.message}`];
            }
          }
          return [id, name, `Function not found`];
        })
      );

      const newMessages: Message[] = results.map(([id, _name, result]) => ({
        role: "tool",
        content: result as string,
        tool_call_id: id as string,
      }));

      const describeMessage = newMessages.find(msg => msg.content.startsWith(ToolReturnTag.Response));
      const responseContent = extractToolResponse(describeMessage?.content || "");
      if (responseContent) {
        newMessages.push({ role: "assistant", content: responseContent });
        await stimulateStreamResponse({ content: responseContent, partialCallback, endResolve, endCallback });
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
  } catch (err: any) {
    console.error("AWS Bedrock Error:", err.message);
    endResolve();
    endCallback();
  }

  return promise;
};

const summaryTextWithLLM: SummaryTextWithLLMFunction = async (text: string, promptPrefix: string): Promise<string> => {
  if (!client) {
    return text;
  }
  try {
    const command = new ConverseStreamCommand({
      modelId: awsBedrockModel,
      messages: [{ role: "user", content: [{ text: `${promptPrefix}\n\n${text}\n\n` }] }],
    });
    const response = await client.send(command);
    let summary = "";
    if (response.stream) {
      for await (const chunk of response.stream) {
        if (chunk.contentBlockDelta?.delta?.text) {
          summary += chunk.contentBlockDelta.delta.text;
        }
      }
    }
    return summary || text;
  } catch (err: any) {
    console.error("AWS Bedrock summary error:", err.message);
    return text;
  }
};

export default { chatWithLLMStream, resetChatHistory, summaryTextWithLLM };
