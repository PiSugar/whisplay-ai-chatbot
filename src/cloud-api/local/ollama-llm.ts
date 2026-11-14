import axios from "axios";
import { readOllamaNDJSON } from "./ollama-ndjson";
import * as fs from "fs";
import * as path from "path";
import { isEmpty } from "lodash";
import {
  shouldResetChatHistory,
  systemPrompt,
  updateLastMessageTime,
} from "../../config/llm-config";
import { llmTools, llmFuncMap } from "../../config/llm-tools";
import dotenv from "dotenv";
import {
  Message,
  OllamaFunctionCall,
  OllamaMessage,
  ToolReturnTag,
} from "../../type";
import { ChatWithLLMStreamFunction, SummaryTextWithLLMFunction } from "../interface";
import { chatHistoryDir } from "../../utils/dir";
import moment from "moment";
import {
  extractToolResponse,
  stimulateStreamResponse,
} from "../../config/common";
import { defaultPortMap } from "./common";
import {
  consumePendingCapturedImgForChat,
  hasPendingCapturedImgForChat,
} from "../../utils/image";
import { compactMessagesForContextWindow } from "../context-window";

dotenv.config();

// Ollama LLM configuration
const ollamaEndpoint =
  process.env.OLLAMA_ENDPOINT || `http://localhost:${defaultPortMap.ollama}`;
const ollamaModel = process.env.OLLAMA_MODEL || "deepseek-r1:1.5b";
const ollamaEnableTools = process.env.OLLAMA_ENABLE_TOOLS === "true";
const ollamaMaxToolRounds = Math.max(
  0,
  parseInt(process.env.OLLAMA_MAX_TOOL_ROUNDS || "4", 10) || 0,
);
const ollamaPredictNum = process.env.OLLAMA_PREDICT_NUM
  ? parseInt(process.env.OLLAMA_PREDICT_NUM)
  : undefined;
const enableThinking = process.env.ENABLE_THINKING === "true";
const useCapturedImageInChat =
  (process.env.USE_CAPTURED_IMAGE_IN_CHAT || "false").toLowerCase() ===
  "true";

const llmServer = process.env.LLM_SERVER || "";

let ollamaContextWindowCache: number | undefined;

const findContextWindowValue = (value: unknown): number | undefined => {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      /(context_length|num_ctx|context.*length)$/i.test(key) &&
      Number.isFinite(Number(child)) &&
      Number(child) > 0
    ) {
      return Number(child);
    }
    const nested = findContextWindowValue(child);
    if (nested) return nested;
  }
  return undefined;
};

const resolveOllamaContextWindow = async (): Promise<number | undefined> => {
  if (ollamaContextWindowCache) return ollamaContextWindowCache;
  const response = await axios.post(`${ollamaEndpoint}/api/show`, {
    model: ollamaModel,
  });
  ollamaContextWindowCache =
    findContextWindowValue(response.data?.model_info) ||
    findContextWindowValue(response.data?.details) ||
    findContextWindowValue(response.data);
  return ollamaContextWindowCache;
};

const toWireMessage = ({ role, content, tool_calls, tool_name, tool_call_id }: OllamaMessage) => ({
  role,
  content,
  ...(tool_calls?.length ? { tool_calls: tool_calls.flat() } : {}),
  ...(tool_name ? { tool_name } : {}),
  ...(tool_call_id ? { tool_call_id } : {}),
});

const chatHistoryFileName = `ollama_chat_history_${moment().format(
  "YYYY-MM-DD_HH-mm-ss",
)}.json`;

const messages: OllamaMessage[] = [
  {
    role: "system",
    content: systemPrompt,
  },
];

const keepAliveOllama = () => {
  axios
    .post(`${ollamaEndpoint}/api/chat`, {
      model: ollamaModel,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
      ],
      options: {
        temperature: 0.7,
        num_predict: 1,
      },
      think: false,
      stream: false,
      tools: ollamaEnableTools ? llmTools : undefined,
      keep_alive: -1,
    })
    .then((response) => {
      console.log("Ollama keep-alive response:", response.data);
    })
    .catch((err) => {
      console.error("Error initializing Ollama model:", err.message);
    });
};

if (llmServer.trim().toLowerCase() === "ollama") {
  // initialize request to ollama server with empty prompt, to load the model into memory
  keepAliveOllama();
}

const resetChatHistory = (): void => {
  messages.length = 0;
  messages.push({
    role: "system",
    content: systemPrompt,
  });
};

type ToolLoopState = {
  round: number;
  signatures: Set<string>;
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const toolCallSignature = (call: OllamaFunctionCall): string =>
  `${call.function?.name || ""}:${stableStringify(call.function?.arguments || {})}`;

// Only results produced after the latest user message belong to the current request;
// earlier turns' results are never offered as an answer source.
const previousToolResultFor = (toolName: string): string => {
  const requestStart = messages.map((message) => message.role).lastIndexOf("user");
  const previous = messages
    .slice(requestStart + 1)
    .reverse()
    .find((message) => message.role === "tool" && message.tool_name === toolName);
  return previous?.content || "";
};

const answerFromAvailableToolResults = async ({
  instruction,
  partialCallback,
  endResolve,
  endCallback,
  partialThinkingCallback,
}: {
  instruction: string;
  partialCallback: (partialAnswer: string) => void;
  endResolve: () => void;
  endCallback: () => void;
  partialThinkingCallback?: (partialThinking: string) => void;
}): Promise<void> => {
  let finalAnswer = "";
  let finalThinking = "";
  try {
    const response = await axios.post(
      `${ollamaEndpoint}/api/chat`,
      {
        model: ollamaModel,
        messages: [
          ...messages.map(toWireMessage),
          {
            role: "user",
            content: instruction,
          },
        ],
        think: enableThinking,
        stream: true,
        options: {
          temperature: 0.7,
          num_predict: ollamaPredictNum,
        },
        keep_alive: -1,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        responseType: "stream",
      },
    );

    await readOllamaNDJSON(response.data, (record) => {
      const content = record.message?.content;
      const thinking = record.message?.thinking;
      if (content) {
        partialCallback(content);
        finalAnswer += content;
      }
      if (thinking) {
        partialThinkingCallback?.(thinking);
        finalThinking += thinking;
      }
    });

    if (finalThinking.trim()) {
      console.log(`[Ollama] Final no-tools thinking length: ${finalThinking.length}`);
    }
    messages.push({
      role: "assistant",
      content: finalAnswer,
    });
  } catch (error: any) {
    console.error("Error generating final answer from tool results:", error.message);
  } finally {
    endResolve();
    endCallback();
  }
};

const chatWithLLMStreamInternal = async (
  inputMessages: Message[] = [],
  partialCallback: (partialAnswer: string) => void,
  endCallback: () => void,
  partialThinkingCallback?: (partialThinking: string) => void,
  invokeFunctionCallback?: (functionName: string, result?: string) => void,
  toolLoopState: ToolLoopState = { round: 0, signatures: new Set<string>() },
): Promise<void> => {
  if (shouldResetChatHistory()) {
    resetChatHistory();
  }
  updateLastMessageTime();
  messages.push(...(inputMessages as OllamaMessage[]));
  await compactMessagesForContextWindow({
    provider: "ollama",
    model: ollamaModel,
    messages,
    tools: ollamaEnableTools ? llmTools : undefined,
    outputReserveTokens: ollamaPredictNum,
    contextWindowResolver: resolveOllamaContextWindow,
    invokeFunctionCallback,
  });
  let endResolve: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    endResolve = resolve;
  }).finally(() => {
    // save chat history to file
    fs.writeFileSync(
      path.join(chatHistoryDir, chatHistoryFileName),
      JSON.stringify(messages, null, 2),
    );
  });
  let partialAnswer = "";
  let partialThinking = "";
  const functionCallsPackages: OllamaFunctionCall[][] = [];

  try {
    const lastUserMessageIndex = messages
      .map((msg, index) => ({ msg, index }))
      .filter(({ msg }) => msg.role === "user")
      .map(({ index }) => index)
      .pop();
    const capturedImagePath =
      useCapturedImageInChat &&
      lastUserMessageIndex !== undefined &&
      hasPendingCapturedImgForChat()
        ? consumePendingCapturedImgForChat()
        : "";
    const capturedImageBase64 = capturedImagePath
      ? fs.readFileSync(capturedImagePath).toString("base64")
      : "";

    const response = await axios.post(
      `${ollamaEndpoint}/api/chat`,
      {
        model: ollamaModel,
        messages: messages.map((msg, index) => ({
          ...toWireMessage(msg),
          ...(capturedImageBase64 &&
          msg.role === "user" &&
          lastUserMessageIndex !== undefined &&
          index === lastUserMessageIndex
            ? { images: [capturedImageBase64] }
            : {}),
        })),
        think: enableThinking,
        stream: true,
        options: {
          temperature: 0.7,
          num_predict: ollamaPredictNum,
        },
        tools: ollamaEnableTools ? llmTools : undefined,
        keep_alive: -1,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        responseType: "stream",
      },
    );

    await readOllamaNDJSON(response.data, (record) => {
      const message = record.message;
      if (message?.content) {
        partialCallback(message.content);
        partialAnswer += message.content;
      }
      if (message?.thinking) {
        partialThinkingCallback?.(message.thinking);
        partialThinking += message.thinking;
      }
      if (message?.tool_calls?.length) functionCallsPackages.push(message.tool_calls);
    });

    console.log("Stream ended");
    const functionCalls = functionCallsPackages.flat();
    console.log(
      "functionCallsPackages: ",
      JSON.stringify(functionCallsPackages),
    );
    console.log("functionCalls: ", JSON.stringify(functionCalls));


    if (!isEmpty(functionCalls)) {
      if (toolLoopState.round >= ollamaMaxToolRounds) {
        console.warn(`[ToolLoop] Reached OLLAMA_MAX_TOOL_ROUNDS=${ollamaMaxToolRounds}.`);
        await answerFromAvailableToolResults({
          instruction:
            "You have already checked enough tool results for this request. Answer the user's latest request now using the available conversation and tool results. Do not call or ask for another tool. Do not mention internal tool instructions, raw status markers such as [success], exit_code, duration_ms, timed_out, truncated, or phrases like previous tool result.",
          partialCallback,
          endResolve,
          endCallback,
          partialThinkingCallback,
        });
        return;
      }

      // Identical calls inside one response collapse to their first occurrence.
      const inResponse = new Set<string>();
      const uniquePackages = functionCallsPackages
        .map((calls) =>
          calls.filter((call) => {
            const signature = toolCallSignature(call);
            if (inResponse.has(signature)) return false;
            inResponse.add(signature);
            return true;
          }),
        )
        .filter((calls) => calls.length);
      const uniqueCalls = uniquePackages.flat();
      // Only a call executed earlier in this top-level request is blocked.
      const duplicateCall = uniqueCalls.find((call) =>
        toolLoopState.signatures.has(toolCallSignature(call)),
      );
      if (duplicateCall) {
        const signature = toolCallSignature(duplicateCall);
        const name = duplicateCall.function?.name || "tool";
        const previous = previousToolResultFor(name);
        console.warn(`[ToolLoop] Repeated tool call blocked: ${signature}`);
        await answerFromAvailableToolResults({
          instruction: [
            `The ${name} tool was already called for this request, so do not call it again.`,
            "Answer the user's latest request now using the available result below.",
            "Do not mention internal tool instructions, raw status markers such as [success], exit_code, duration_ms, timed_out, truncated, or phrases like previous tool result.",
            previous ? `\nAvailable ${name} result:\n${previous}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          partialCallback,
          endResolve,
          endCallback,
          partialThinkingCallback,
        });
        return;
      }

      for (const call of uniqueCalls) {
        toolLoopState.signatures.add(toolCallSignature(call));
      }

      messages.push({
        role: "assistant",
        content: partialAnswer,
        tool_calls: uniquePackages,
      });
      const results = await Promise.all(
        uniqueCalls.map(async (call: OllamaFunctionCall) => {
          const {
            id,
            function: { arguments: args, name },
          } = call;
          const func = llmFuncMap[name! as string];
          if (func) {
            invokeFunctionCallback?.(name! as string);
            return [
              name,
              id,
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
            return [name, id, `Function ${name} not found`];
          }
        }),
      );

      const newMessages: OllamaMessage[] = results.map(
        ([name, id, result]) => ({
          role: "tool",
          content: result as string,
          tool_name: name as string,
          ...(id ? { tool_call_id: id } : {}),
        }),
      );

      // Directly extract and return the tool result if available
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
        messages.push(...newMessages, { role: "assistant", content: responseContent });
        // append responseContent in chunks
        await stimulateStreamResponse({
          content: responseContent,
          partialCallback,
          endResolve,
          endCallback,
        });
        return;
      }

      await chatWithLLMStreamInternal(
        newMessages as Message[],
        partialCallback,
        () => {
          endResolve();
          endCallback();
        },
        partialThinkingCallback,
        invokeFunctionCallback,
        {
          round: toolLoopState.round + 1,
          signatures: toolLoopState.signatures,
        },
      );
      return;
    } else {
      messages.push({ role: "assistant", content: partialAnswer });
      endResolve();
      endCallback();
    }
  } catch (error: any) {
    console.error("Error:", error.message);
    endResolve();
    endCallback();
  }

  return promise;
};

const chatWithLLMStream: ChatWithLLMStreamFunction = async (
  inputMessages: Message[] = [],
  partialCallback: (partialAnswer: string) => void,
  endCallback: () => void,
  partialThinkingCallback?: (partialThinking: string) => void,
  invokeFunctionCallback?: (functionName: string, result?: string) => void,
): Promise<void> =>
  chatWithLLMStreamInternal(
    inputMessages,
    partialCallback,
    endCallback,
    partialThinkingCallback,
    invokeFunctionCallback,
  );

const summaryTextWithLLM: SummaryTextWithLLMFunction = async (
  text: string, promptPrefix: string
): Promise<string> => {
  const prompt = `${promptPrefix}\n\n${text}\n\n`;

  const response = await axios.post(
    `${ollamaEndpoint}/api/generate`,
    {
      model: ollamaModel,
      prompt: prompt,
      stream: false,
      think: false,
    }
  );

  if (response.data && response.data.response) {
    const summary = response.data.response;
    console.log("Ollama summary:", summary);
    return summary;
  } else {
    console.log("No summary returned from Ollama.");
    return "";
  }
}

export default { chatWithLLMStream, resetChatHistory, summaryTextWithLLM };
