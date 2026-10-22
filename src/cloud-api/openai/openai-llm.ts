import dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { isEmpty } from "lodash";
import moment from "moment";
import {
  shouldResetChatHistory,
  systemPrompt,
  updateLastMessageTime,
} from "../../config/llm-config";
import { FunctionCall, Message, ToolReturnTag } from "../../type";
import { combineFunction, formatToolResultsForLog } from "../../utils";
import { openai } from "./openai"; // Assuming openai is exported from openai.ts
import { llmFuncMap, llmTools } from "../../config/llm-tools";
import {
  SummaryTextWithLLMFunction,
} from "../interface";
import { chatHistoryDir } from "../../utils/dir";
import {
  consumePendingCapturedImgForChat,
  hasPendingCapturedImgForChat,
  getImageMimeType,
} from "../../utils/image";
import { compactMessagesForContextWindow } from "../context-window";

dotenv.config();
// OpenAI LLM
const openaiLLMModel = process.env.OPENAI_LLM_MODEL || "gpt-4o"; // Default model
const openaiEnableTools =
  (process.env.OPENAI_ENABLE_TOOLS || "true").toLowerCase() === "true";
const shouldIncludeTools = openaiEnableTools;
const useCapturedImageInChat =
  (process.env.USE_CAPTURED_IMAGE_IN_CHAT || "false").toLowerCase() === "true";
const openaiUseStream =
  (process.env.OPENAI_USE_STREAM || "true").toLowerCase() === "true";
const openaiUseImagePath =
  (process.env.OPENAI_USE_IMAGE_PATH || "false").toLowerCase() === "true";
const configuredOpenaiApiMode = (
  process.env.OPENAI_API_MODE || "auto"
).toLowerCase();
const openaiBaseUrl = process.env.OPENAI_API_BASE_URL;
const isOfficialOpenaiEndpoint = (() => {
  if (!openaiBaseUrl) return true;
  try {
    return new URL(openaiBaseUrl).hostname === "api.openai.com";
  } catch {
    return false;
  }
})();
const openaiApiMode =
  configuredOpenaiApiMode === "responses" ||
  configuredOpenaiApiMode === "chat-completions"
    ? configuredOpenaiApiMode
    : isOfficialOpenaiEndpoint
      ? "responses"
      : "chat-completions";
const openaiMaxMessagesLength = parseInt(
  process.env.OPENAI_MAX_MESSAGES_LENGTH || "0",
  10,
);

const emptyObjectParameters = {
  type: "object",
  properties: {},
};

const normalizeToolParameters = (parameters: any) => {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    return emptyObjectParameters;
  }
  return {
    ...parameters,
    type: parameters.type || "object",
    properties: parameters.properties || {},
  };
};

const openaiTools = llmTools.map((tool) => ({
  ...tool,
  function: {
    ...tool.function,
    parameters: normalizeToolParameters(tool.function.parameters),
  },
}));

const openaiResponseTools = openaiTools.map((tool) => ({
  type: "function" as const,
  name: tool.function.name,
  description: tool.function.description,
  parameters: tool.function.parameters,
  strict: false,
}));

if (!["auto", "responses", "chat-completions"].includes(configuredOpenaiApiMode)) {
  console.warn(
    `[OpenAI] Unknown OPENAI_API_MODE=${configuredOpenaiApiMode}; using ${openaiApiMode}.`,
  );
}
console.log(`[OpenAI] model=${openaiLLMModel} api_mode=${openaiApiMode}`);

const buildImageDataUrl = (imagePath: string): string => {
  const mimeType = getImageMimeType(imagePath) || "image/jpeg";
  const base64 = fs.readFileSync(imagePath).toString("base64");
  return `data:${mimeType};base64,${base64}`;
};

const chatHistoryFileName = `openai_chat_history_${moment().format(
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

const buildResponsesInput = (
  sourceMessages: Message[],
  capturedImagePath: string,
  lastUserMessageIndex: number | undefined,
): any[] => {
  const input: any[] = [];

  sourceMessages.forEach((message, index) => {
    if (message.role === "tool") {
      if (message.tool_call_id) {
        input.push({
          type: "function_call_output",
          call_id: message.tool_call_id,
          output: message.content,
        });
      }
      return;
    }

    if (message.content) {
      const isCapturedImageMessage =
        capturedImagePath &&
        message.role === "user" &&
        lastUserMessageIndex !== undefined &&
        index === lastUserMessageIndex;
      input.push({
        type: "message",
        role: message.role,
        content: isCapturedImageMessage
          ? [
              { type: "input_text", text: message.content },
              {
                type: "input_image",
                image_url: openaiUseImagePath
                  ? capturedImagePath
                  : buildImageDataUrl(capturedImagePath),
              },
            ]
          : message.content,
      });
    }

    message.tool_calls?.forEach((call) => {
      if (!call.id || !call.function.name) return;
      input.push({
        type: "function_call",
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments || "{}",
      });
    });
  });

  return input;
};

const responseFunctionCall = (item: any, index: number): FunctionCall => ({
  id: item.call_id,
  index,
  type: "function",
  function: {
    name: item.name,
    arguments: item.arguments || "{}",
  },
});

const describeOpenaiError = (error: any): string => {
  const details = [
    error?.message || String(error),
    error?.status ? `status=${error.status}` : "",
    error?.code ? `code=${error.code}` : "",
    error?.param ? `param=${error.param}` : "",
  ].filter(Boolean);
  return details.join("; ");
};

const chatWithLLMStream = async (
  inputMessages: Message[] = [],
  partialCallback: (partial: string) => void,
  endCallback: () => void,
  partialThinkingCallback?: (partialThinking: string) => void,
  invokeFunctionCallback?: (functionName: string, result?: string) => void,
  previousResponseId?: string,
): Promise<void> => {
  if (!openai) {
    throw new Error("OpenAI API key is not set.");
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
  // Trim messages to MAX_MESSAGES_LENGTH (keep first system prompt + last N messages)
  if (openaiMaxMessagesLength > 0 && messages.length > openaiMaxMessagesLength + 1) {
    const firstSystemMessage = messages[0];
    const restMessages = messages.slice(1);
    const trimmed = restMessages.slice(-openaiMaxMessagesLength);
    messages.length = 0;
    messages.push(firstSystemMessage, ...trimmed);
  }
  await compactMessagesForContextWindow({
    provider: "openai",
    model: openaiLLMModel,
    messages,
    tools: shouldIncludeTools ? openaiTools : undefined,
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
            url: openaiUseImagePath ? capturedImagePath : buildImageDataUrl(capturedImagePath),
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
  let responseApiResponseId: string | undefined;
  try {
    if (openaiApiMode === "responses") {
      const responseInput = buildResponsesInput(
        previousResponseId ? inputMessages : messages,
        capturedImagePath,
        previousResponseId ? undefined : lastUserMessageIndex,
      );
      if (openaiUseStream) {
        const responseStream = await openai.responses.create({
          model: openaiLLMModel,
          input: responseInput,
          previous_response_id: previousResponseId,
          stream: true,
          tools: shouldIncludeTools ? openaiResponseTools : undefined,
        });
        for await (const event of responseStream) {
          if (event.type === "response.created") {
            responseApiResponseId = event.response.id;
          } else if (event.type === "response.output_text.delta") {
            partialCallback(event.delta);
            answer += event.delta;
          } else if (event.type === "response.reasoning_text.delta") {
            partialThinkingCallback?.(event.delta);
          } else if (
            event.type === "response.output_item.done" &&
            event.item.type === "function_call"
          ) {
            functionCalls.push(
              responseFunctionCall(event.item, functionCalls.length),
            );
          } else if (event.type === "response.completed") {
            responseApiResponseId = event.response.id;
          } else if (event.type === "error") {
            throw new Error(event.message);
          } else if (event.type === "response.failed") {
            throw new Error(
              event.response.error?.message || "OpenAI response failed.",
            );
          }
        }
      } else {
        const response = await openai.responses.create({
          model: openaiLLMModel,
          input: responseInput,
          previous_response_id: previousResponseId,
          stream: false,
          tools: shouldIncludeTools ? openaiResponseTools : undefined,
        });
        responseApiResponseId = response.id;
        answer = response.output_text || "";
        if (answer) partialCallback(answer);
        functionCalls = response.output
          .filter((item) => item.type === "function_call")
          .map((item, index) => responseFunctionCall(item, index));
      }
    } else if (openaiUseStream) {
      const chatCompletion = await openai.chat.completions.create({
        model: openaiLLMModel,
        messages: requestMessages as any,
        stream: true,
        tools: shouldIncludeTools ? openaiTools : undefined,
      });
      const functionCallsPackages: any[] = [];
      for await (const chunk of chatCompletion) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          partialCallback(delta.content);
          answer += delta.content;
        }
        if (delta?.tool_calls) {
          functionCallsPackages.push(...delta.tool_calls);
        }
      }
      functionCalls = combineFunction(functionCallsPackages);
    } else {
      const chatCompletion = await openai.chat.completions.create({
        model: openaiLLMModel,
        messages: requestMessages as any,
        stream: false,
        tools: shouldIncludeTools ? openaiTools : undefined,
      });
      if (chatCompletion.choices.length > 0) {
        const msg = chatCompletion.choices[0].message;
        answer = msg?.content || "";
        if (answer) partialCallback(answer);
        functionCalls = combineFunction((msg?.tool_calls as any) || []);
      }
    }
  } catch (error: any) {
    const description = describeOpenaiError(error);
    console.error(
      `[OpenAI] request failed model=${openaiLLMModel} api_mode=${openaiApiMode}: ${description}`,
    );
    throw error;
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
            `Error parsing arguments for function ${name}:`,
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
                console.error(`Error executing function ${name}:`, err);
                return `Error executing function ${name}: ${err.message}`;
              }),
          ];
        } else {
          console.error(`Function ${name} not found`);
          return [id, `Function ${name} not found`];
        }
      }),
    );

    console.log("call results: ", formatToolResultsForLog(results, functionCalls));
    const newMessages: Message[] = results.map(([id, result]: any) => ({
      role: "tool",
      content: result as string,
      tool_call_id: id as string,
    }));

    await chatWithLLMStream(
      newMessages,
      partialCallback,
      () => {
        endResolve();
        endCallback();
      },
      partialThinkingCallback,
      invokeFunctionCallback,
      responseApiResponseId,
    );
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
  if (!openai) {
    console.error("OpenAI API key is not set. Using original text.");
    return text;
  }
  if (openaiApiMode === "responses") {
    const response = await openai.responses
      .create({
        model: openaiLLMModel,
        instructions: promptPrefix,
        input: text,
        stream: false,
      })
      .catch((error) => {
        console.log("Error during OpenAI summary request:", describeOpenaiError(error));
        return null;
      });
    if (!response) return text;
    const summary = response.output_text || "";
    console.log("OpenAI summary:", summary);
    return summary || text;
  }

  const chatCompletion = await openai.chat.completions.create({
    model: openaiLLMModel,
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
  }).catch((error) => {
    console.log("Error during OpenAI summary request:", describeOpenaiError(error));
    return null;
  });
  if (!chatCompletion) {
    return text;
  }
  if (chatCompletion.choices && chatCompletion.choices.length > 0) {
    const summary = chatCompletion.choices[0].message?.content || "";
    console.log("OpenAI summary:", summary);
    return summary;
  } else {
    console.log("No summary returned from OpenAI. Using original text.");
    return text;
  }
};

export default { chatWithLLMStream, resetChatHistory, summaryTextWithLLM };
