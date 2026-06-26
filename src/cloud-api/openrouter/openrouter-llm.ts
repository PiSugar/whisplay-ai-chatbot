import dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { isEmpty } from "lodash";
import moment from "moment";
import { OpenAI, ClientOptions } from "openai";
import {
  shouldResetChatHistory,
  systemPrompt,
  updateLastMessageTime,
} from "../../config/llm-config";
import { FunctionCall, Message, ToolReturnTag } from "../../type";
import { combineFunction, formatToolResultsForLog } from "../../utils";
import { llmFuncMap, llmTools } from "../../config/llm-tools";
import {
  ChatWithLLMStreamFunction,
  SummaryTextWithLLMFunction,
} from "../interface";
import { chatHistoryDir } from "../../utils/dir";
import {
  consumePendingCapturedImgForChat,
  hasPendingCapturedImgForChat,
  getImageMimeType,
} from "../../utils/image";
import { proxyFetch } from "../proxy-fetch";
import {
  extractToolResponse,
  stimulateStreamResponse,
} from "../../config/common";
import { compactMessagesForContextWindow } from "../context-window";

dotenv.config();

const openrouterApiKey = process.env.OPENROUTER_API_KEY || "";
const openrouterModel =
  process.env.OPENROUTER_LLM_MODEL || "openai/gpt-4o";
const openrouterEnableTools =
  (process.env.OPENROUTER_ENABLE_TOOLS || "true").toLowerCase() === "true";
const useCapturedImageInChat =
  (process.env.USE_CAPTURED_IMAGE_IN_CHAT || "false").toLowerCase() === "true";
const openrouterUseStream =
  (process.env.OPENROUTER_USE_STREAM || "true").toLowerCase() === "true";
const openrouterMaxMessagesLength = parseInt(
  process.env.OPENROUTER_MAX_MESSAGES_LENGTH || "0",
  10,
);

const openrouterOptions: ClientOptions = {
  apiKey: openrouterApiKey,
  baseURL: "https://openrouter.ai/api/v1",
  fetch: proxyFetch as any,
};

const openrouter = openrouterApiKey
  ? new OpenAI(openrouterOptions)
  : null;

let openrouterModelContextCache: Record<string, number> | null = null;

const resolveOpenRouterContextWindow = async (): Promise<number | undefined> => {
  if (!openrouterModelContextCache) {
    const response = await proxyFetch("https://openrouter.ai/api/v1/models", {
      headers: openrouterApiKey
        ? { Authorization: `Bearer ${openrouterApiKey}` }
        : undefined,
    } as any);
    const payload = await response.json();
    openrouterModelContextCache = {};
    for (const modelInfo of payload?.data || []) {
      const contextLength = Number(modelInfo?.context_length);
      if (modelInfo?.id && Number.isFinite(contextLength) && contextLength > 0) {
        openrouterModelContextCache[modelInfo.id] = contextLength;
      }
    }
  }
  return openrouterModelContextCache[openrouterModel];
};

const buildImageDataUrl = (imagePath: string): string => {
  const mimeType = getImageMimeType(imagePath) || "image/jpeg";
  const base64 = fs.readFileSync(imagePath).toString("base64");
  return `data:${mimeType};base64,${base64}`;
};

const chatHistoryFileName = `openrouter_chat_history_${moment().format(
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

const chatWithLLMStream: ChatWithLLMStreamFunction = async (
  inputMessages: Message[] = [],
  partialCallback: (partial: string) => void,
  endCallback: () => void,
  partialThinkingCallback?: (partialThinking: string) => void,
  invokeFunctionCallback?: (functionName: string, result?: string) => void,
): Promise<void> => {
  if (!openrouter) {
    console.error("[OpenRouter] API key is not set.");
    endCallback();
    return;
  }
  if (shouldResetChatHistory()) {
    resetChatHistory();
  }
  updateLastMessageTime();
  let endResolve: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    endResolve = resolve;
  }).finally(() => {
    fs.writeFileSync(
      path.join(chatHistoryDir, chatHistoryFileName),
      JSON.stringify(messages, null, 2),
    );
  });
  messages.push(...inputMessages);
  // Trim messages to max length (keep first system prompt + last N messages)
  if (
    openrouterMaxMessagesLength > 0 &&
    messages.length > openrouterMaxMessagesLength + 1
  ) {
    const firstSystemMessage = messages[0];
    const restMessages = messages.slice(1);
    const trimmed = restMessages.slice(-openrouterMaxMessagesLength);
    messages.length = 0;
    messages.push(firstSystemMessage, ...trimmed);
  }
  await compactMessagesForContextWindow({
    provider: "openrouter",
    model: openrouterModel,
    messages,
    tools: openrouterEnableTools ? llmTools : undefined,
    contextWindowResolver: resolveOpenRouterContextWindow,
    invokeFunctionCallback,
  });

  const lastUserMessage = [...inputMessages]
    .reverse()
    .find((msg) => msg.role === "user");
  const capturedImagePath =
    useCapturedImageInChat && lastUserMessage && hasPendingCapturedImgForChat()
      ? consumePendingCapturedImgForChat()
      : "";
  const multimodalLastUserContent = capturedImagePath
    ? [
        {
          type: "text",
          text: lastUserMessage?.content || "",
        },
        {
          type: "image_url",
          image_url: {
            url: buildImageDataUrl(capturedImagePath),
          },
        },
      ]
    : [
        {
          type: "text",
          text: lastUserMessage?.content || "",
        },
      ];

  const lastUserMessageIndex = messages
    .map((msg, index) => ({ msg, index }))
    .filter(({ msg }) => msg.role === "user")
    .map(({ index }) => index)
    .pop();

  const requestMessages = messages.map((msg, index) => {
    if (
      capturedImagePath &&
      msg.role === "user" &&
      lastUserMessageIndex !== undefined &&
      index === lastUserMessageIndex
    ) {
      return {
        role: "user",
        content: multimodalLastUserContent,
      };
    }
    return {
      role: msg.role,
      content: msg.content,
      ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
      ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
    };
  });

  let answer = "";
  let functionCalls: FunctionCall[] = [];
  if (openrouterUseStream) {
    const chatCompletion = await openrouter.chat.completions
      .create({
        model: openrouterModel,
        messages: requestMessages as any,
        stream: true,
        tools: openrouterEnableTools ? llmTools : undefined,
      })
      .catch((error) => {
        console.log(
          "[OpenRouter] Error during chat completion request:",
          error.message,
        );
        endResolve();
        endCallback();
        return [];
      });
    let partialAnswer = "";
    const functionCallsPackages: any[] = [];
    for await (const chunk of chatCompletion) {
      if (chunk.choices[0].delta.content) {
        partialCallback(chunk.choices[0].delta.content);
        partialAnswer += chunk.choices[0].delta.content;
      }
      if (chunk.choices[0].delta.tool_calls) {
        functionCallsPackages.push(...chunk.choices[0].delta.tool_calls);
      }
    }
    answer = partialAnswer;
    functionCalls = combineFunction(functionCallsPackages);
  } else {
    const chatCompletion = await openrouter.chat.completions
      .create({
        model: openrouterModel,
        messages: requestMessages as any,
        stream: false,
        tools: openrouterEnableTools ? llmTools : undefined,
      })
      .catch((error) => {
        console.log(
          "[OpenRouter] Error during chat completion request:",
          error.message,
        );
        endResolve();
        endCallback();
        return null;
      });
    if (
      chatCompletion &&
      chatCompletion.choices &&
      chatCompletion.choices.length > 0
    ) {
      const msg = chatCompletion.choices[0].message;
      answer = msg?.content || "";
      partialCallback(answer);
      functionCalls = combineFunction((msg?.tool_calls as any) || []);
    }
  }
  messages.push({
    role: "assistant",
    content: answer,
    tool_calls: isEmpty(functionCalls) ? undefined : functionCalls,
  });
  if (!isEmpty(functionCalls)) {
    const results = await Promise.all(
      functionCalls.map(async (call: FunctionCall) => {
        const {
          function: { arguments: argString, name },
          id,
        } = call;
        let args: Record<string, any> = {};
        try {
          args = JSON.parse(argString || "{}");
        } catch {
          console.error(
            `[OpenRouter] Error parsing arguments for function ${name}:`,
            argString,
          );
        }
        const func = llmFuncMap[name! as string];
        invokeFunctionCallback?.(name! as string);
        if (func) {
          return [
            id,
            await func(args)
              .then((res) => {
                invokeFunctionCallback?.(name! as string, res);
                return res;
              })
              .catch((err) => {
                console.error(
                  `[OpenRouter] Error executing function ${name}:`,
                  err,
                );
                return `Error executing function ${name}: ${err.message}`;
              }),
          ];
        } else {
          console.error(`[OpenRouter] Function ${name} not found`);
          return [id, `Function ${name} not found`];
        }
      }),
    );

    console.log("[OpenRouter] call results: ", formatToolResultsForLog(results, functionCalls));
    const newMessages: Message[] = results.map(([id, result]: any) => ({
      role: "tool",
      content: result as string,
      tool_call_id: id as string,
    }));

    const describeMessage = newMessages.find((msg) =>
      msg.content.startsWith(ToolReturnTag.Response),
    );
    const responseContent = extractToolResponse(
      describeMessage?.content || "",
    );
    if (responseContent) {
      newMessages.push({ role: "assistant", content: responseContent });
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
  return promise;
};

const summaryTextWithLLM: SummaryTextWithLLMFunction = async (
  text: string,
  promptPrefix: string,
): Promise<string> => {
  if (!openrouter) {
    console.error("[OpenRouter] API key is not set. Using original text.");
    return text;
  }
  const chatCompletion = await openrouter.chat.completions
    .create({
      model: openrouterModel,
      messages: [
        {
          role: "system",
          content: promptPrefix,
        },
        {
          role: "user",
          content: text,
        },
      ],
      stream: false,
    })
    .catch((error) => {
      console.log("[OpenRouter] Error during summary request:", error.message);
      return null;
    });
  if (!chatCompletion) {
    return text;
  }
  if (chatCompletion.choices && chatCompletion.choices.length > 0) {
    const summary = chatCompletion.choices[0].message?.content || "";
    console.log("[OpenRouter] summary:", summary);
    return summary;
  } else {
    console.log("[OpenRouter] No summary returned. Using original text.");
    return text;
  }
};

export default { chatWithLLMStream, resetChatHistory, summaryTextWithLLM };
