import fs from "fs";
import path from "path";
import moment from "moment";
import { isEmpty } from "lodash";
import {
  shouldResetChatHistory,
  systemPrompt,
  updateLastMessageTime,
} from "../../config/llm-config";
import { llmFuncMap, llmTools } from "../../config/llm-tools";
import { FunctionCall, Message } from "../../type";
import { combineFunction, formatToolResultsForLog } from "../../utils";
import { chatHistoryDir } from "../../utils/dir";
import {
  consumePendingCapturedImgForChat,
  getImageMimeType,
  hasPendingCapturedImgForChat,
} from "../../utils/image";
import { compactMessagesForContextWindow } from "../context-window";
import { ChatWithLLMStreamFunction, SummaryTextWithLLMFunction } from "../interface";
import { proxyFetch } from "../proxy-fetch";
import {
  deepseek,
  deepseekApiKey,
  deepseekEndpoint,
  deepseekHeaders,
  deepseekLLMModel,
  describeDeepseekHttpError,
} from "./deepseek";

const configuredApiMode = (process.env.DEEPSEEK_API_MODE || "responses").toLowerCase();
const apiMode = configuredApiMode === "chat-completions"
  ? "chat-completions"
  : "responses";
const enableTools = (process.env.DEEPSEEK_ENABLE_TOOLS || "true").toLowerCase() === "true";
const enableWebSearch =
  (process.env.DEEPSEEK_ENABLE_WEB_SEARCH || "false").toLowerCase() === "true";
const enableUrlReading =
  (process.env.DEEPSEEK_ENABLE_URL_READING || "false").toLowerCase() === "true";
const useStream = (process.env.DEEPSEEK_USE_STREAM || "true").toLowerCase() === "true";
const useCapturedImage =
  (process.env.USE_CAPTURED_IMAGE_IN_CHAT || "false").toLowerCase() === "true";
const maxMessagesLength = parseInt(
  process.env.DEEPSEEK_MAX_MESSAGES_LENGTH || "0",
  10,
);
const requestedEffort = (process.env.DEEPSEEK_REASONING_EFFORT || "high").toLowerCase();
const reasoningEffort = ["none", "low", "high", "max"].includes(requestedEffort)
  ? requestedEffort
  : "high";
const safetyLevel = (process.env.DEEPSEEK_SAFETY_LEVEL || "none").toLowerCase();

if (!["responses", "chat-completions"].includes(configuredApiMode)) {
  console.warn(
    `[DeepSeek] Unknown DEEPSEEK_API_MODE=${configuredApiMode}; using responses.`,
  );
}
console.log(
  `[DeepSeek] model=${deepseekLLMModel} api_mode=${apiMode} reasoning=${reasoningEffort}`,
);

const emptyObjectParameters = { type: "object", properties: {} };
const normalizedTools = llmTools.map((tool) => ({
  type: "function" as const,
  function: {
    name: tool.function.name,
    description: tool.function.description,
    parameters: {
      ...(tool.function.parameters || {}),
      type: tool.function.parameters?.type || "object",
      properties: tool.function.parameters?.properties || {},
    },
  },
}));
const responseTools: any[] = normalizedTools.map((tool) => ({
  type: "function",
  name: tool.function.name,
  description: tool.function.description,
  parameters: tool.function.parameters || emptyObjectParameters,
  strict: false,
}));
const serverTools: any[] = [
  ...(enableWebSearch ? [{ type: "deepseek_web_search" }] : []),
  ...(enableUrlReading ? [{ type: "deepseek_read_url" }] : []),
];

const chatHistoryFileName = `deepseek_chat_history_${moment().format(
  "YYYY-MM-DD_HH-mm-ss",
)}.json`;
const messages: Message[] = [{ role: "system", content: systemPrompt }];
let responseConversation: any[] = [
  { type: "message", role: "system", content: systemPrompt },
];

const resetChatHistory = (): void => {
  messages.length = 0;
  messages.push({ role: "system", content: systemPrompt });
  responseConversation = [
    { type: "message", role: "system", content: systemPrompt },
  ];
};

const buildImageDataUrl = (imagePath: string): string => {
  const mime = getImageMimeType(imagePath) || "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(imagePath).toString("base64")}`;
};

const messageToResponseItems = (
  message: Message,
  imagePath = "",
): any[] => {
  if (message.role === "tool") {
    return message.tool_call_id
      ? [{
          type: "function_call_output",
          call_id: message.tool_call_id,
          output: message.content,
        }]
      : [];
  }

  const content = imagePath && message.role === "user"
    ? [
        { type: "input_text", text: message.content },
        { type: "input_image", image_url: buildImageDataUrl(imagePath), detail: "auto" },
      ]
    : message.content;
  const items: any[] = message.content
    ? [{ type: "message", role: message.role, content }]
    : [];
  message.tool_calls?.forEach((call) => {
    if (call.id && call.function.name) {
      items.push({
        type: "function_call",
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments || "{}",
      });
    }
  });
  return items;
};

const rebuildResponseConversation = (): void => {
  responseConversation = messages.flatMap((message) =>
    messageToResponseItems(message),
  );
};

let modelContextWindow: number | undefined;
const resolveContextWindow = async (): Promise<number | undefined> => {
  if (modelContextWindow) return modelContextWindow;
  if (!deepseekApiKey) return undefined;
  const response = await proxyFetch(deepseekEndpoint("models"), {
    headers: deepseekHeaders(),
  });
  if (!response.ok) {
    throw new Error(await describeDeepseekHttpError(response));
  }
  const payload = (await response.json()) as any;
  const model = (payload?.data || []).find(
    (item: any) => item.id === deepseekLLMModel,
  );
  const contextWindow = Number(model?.context_window);
  if (Number.isFinite(contextWindow) && contextWindow > 0) {
    modelContextWindow = contextWindow;
  }
  return modelContextWindow;
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

const requestExtensions = (): Record<string, any> => ({
  ...(safetyLevel === "high" ? { safety_check: { level: "high" } } : {}),
});

const executeFunctionCalls = async (
  functionCalls: FunctionCall[],
  invokeFunctionCallback?: (functionName: string, result?: string) => void,
): Promise<Message[]> => {
  const results = await Promise.all(
    functionCalls.map(async (call) => {
      const name = call.function.name || "";
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        console.error(`[DeepSeek] Invalid arguments for ${name}:`, call.function.arguments);
      }
      invokeFunctionCallback?.(name);
      const func = llmFuncMap[name];
      if (!func) return [call.id, `Function ${name} not found`];
      try {
        const result = await func(args);
        invokeFunctionCallback?.(name, result);
        return [call.id, result];
      } catch (error: any) {
        return [call.id, `Error executing function ${name}: ${error.message}`];
      }
    }),
  );
  console.log("[DeepSeek] call results:", formatToolResultsForLog(results, functionCalls));
  return results.map(([id, result]) => ({
    role: "tool",
    tool_call_id: id as string,
    content: result as string,
  }));
};

const runResponsesRequest = async (
  partialCallback: (partial: string) => void,
  partialThinkingCallback?: (partial: string) => void,
): Promise<{ answer: string; functionCalls: FunctionCall[]; output: any[] }> => {
  const tools = [
    ...(enableTools ? responseTools : []),
    ...serverTools,
  ];
  const request: any = {
    model: deepseekLLMModel,
    input: responseConversation,
    stream: useStream,
    reasoning: { effort: reasoningEffort },
    ...(tools.length ? { tools } : {}),
    ...requestExtensions(),
  };

  let answer = "";
  let output: any[] = [];
  let functionCalls: FunctionCall[] = [];
  if (useStream) {
    const stream = await deepseek!.responses.create(request);
    for await (const rawEvent of stream as any) {
      const event = rawEvent as any;
      if (event.type === "response.output_text.delta") {
        answer += event.delta || "";
        if (event.delta) partialCallback(event.delta);
      } else if (event.type === "response.reasoning_text.delta") {
        if (event.delta) partialThinkingCallback?.(event.delta);
      } else if (event.type === "response.completed") {
        output = event.response?.output || [];
      } else if (event.type === "response.incomplete") {
        output = event.response?.output || [];
        console.warn("[DeepSeek] Response ended incomplete.");
      } else if (event.type === "response.failed" || event.type === "error") {
        throw new Error(
          event.response?.error?.message || event.message || "DeepSeek response failed.",
        );
      }
    }
    functionCalls = output
      .filter((item) => item.type === "function_call")
      .map((item, index) => responseFunctionCall(item, index));
  } else {
    const response = await deepseek!.responses.create(request) as any;
    answer = response.output_text || "";
    if (answer) partialCallback(answer);
    output = response.output || [];
    functionCalls = output
      .filter((item: any) => item.type === "function_call")
      .map((item: any, index: number) => responseFunctionCall(item, index));
    for (const item of output) {
      if (item.type === "reasoning" && typeof item.content === "string") {
        partialThinkingCallback?.(item.content);
      }
    }
  }
  return { answer, functionCalls, output };
};

const buildChatMessages = (imagePath: string): any[] => {
  let lastUserIndex = -1;
  messages.forEach((message, index) => {
    if (message.role === "user") lastUserIndex = index;
  });
  return messages.map((message, index) => ({
    role: message.role,
    content:
      imagePath && message.role === "user" && index === lastUserIndex
        ? [
            { type: "text", text: message.content },
            { type: "image_url", image_url: { url: buildImageDataUrl(imagePath) } },
          ]
        : message.content,
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    ...(message.reasoning_content
      ? { reasoning_content: message.reasoning_content }
      : {}),
    ...(message.server_tool_calls
      ? { server_tool_calls: message.server_tool_calls }
      : {}),
  }));
};

const runChatCompletionsRequest = async (
  imagePath: string,
  partialCallback: (partial: string) => void,
  partialThinkingCallback?: (partial: string) => void,
): Promise<{
  answer: string;
  reasoning: string;
  functionCalls: FunctionCall[];
  serverToolCalls?: any[];
}> => {
  const tools = [
    ...(enableTools ? normalizedTools : []),
    ...serverTools,
  ];
  const request: any = {
    model: deepseekLLMModel,
    messages: buildChatMessages(imagePath),
    stream: useStream,
    reasoning_effort: reasoningEffort === "none" ? undefined : reasoningEffort,
    thinking: { type: reasoningEffort === "none" ? "disabled" : "enabled" },
    ...(tools.length ? { tools } : {}),
    ...requestExtensions(),
  };
  let answer = "";
  let reasoning = "";
  let functionCalls: FunctionCall[] = [];
  let serverToolCalls: any[] | undefined;
  if (useStream) {
    const stream = await deepseek!.chat.completions.create(request);
    const packages: any[] = [];
    for await (const chunk of stream as any) {
      const delta = chunk.choices?.[0]?.delta || {};
      if (delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        partialThinkingCallback?.(delta.reasoning_content);
      }
      if (delta.content) {
        answer += delta.content;
        partialCallback(delta.content);
      }
      if (delta.tool_calls) packages.push(...delta.tool_calls);
      if (delta.server_tool_calls) serverToolCalls = delta.server_tool_calls;
    }
    functionCalls = combineFunction(packages);
  } else {
    const response = await deepseek!.chat.completions.create(request) as any;
    const message = response.choices?.[0]?.message || {};
    answer = message.content || "";
    reasoning = message.reasoning_content || "";
    if (reasoning) partialThinkingCallback?.(reasoning);
    if (answer) partialCallback(answer);
    functionCalls = combineFunction(message.tool_calls || []);
    serverToolCalls = message.server_tool_calls;
  }
  return { answer, reasoning, functionCalls, serverToolCalls };
};

const chatWithLLMStream: ChatWithLLMStreamFunction = async (
  inputMessages = [],
  partialCallback,
  endCallback,
  partialThinkingCallback,
  invokeFunctionCallback,
): Promise<void> => {
  if (!deepseek) throw new Error("DEEPSEEK_API_KEY is not set.");
  if (shouldResetChatHistory()) resetChatHistory();
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

  const lastUser = [...inputMessages].reverse().find((item) => item.role === "user");
  const capturedImagePath =
    useCapturedImage && lastUser && hasPendingCapturedImgForChat()
      ? consumePendingCapturedImgForChat()
      : "";

  messages.push(...inputMessages);
  inputMessages.forEach((message) => {
    const imagePath = message === lastUser ? capturedImagePath : "";
    responseConversation.push(...messageToResponseItems(message, imagePath));
  });

  let historyChanged = false;
  if (maxMessagesLength > 0 && messages.length > maxMessagesLength + 1) {
    messages.splice(1, messages.length - maxMessagesLength - 1);
    historyChanged = true;
  }
  const historyBeforeCompaction = JSON.stringify(messages);
  await compactMessagesForContextWindow({
    provider: "deepseek",
    model: deepseekLLMModel,
    messages,
    tools: enableTools ? normalizedTools : undefined,
    contextWindowResolver: resolveContextWindow,
    invokeFunctionCallback,
  });
  historyChanged ||= historyBeforeCompaction !== JSON.stringify(messages);
  if (historyChanged) rebuildResponseConversation();

  try {
    let answer = "";
    let functionCalls: FunctionCall[] = [];
    let reasoning = "";
    let serverToolCalls: any[] | undefined;
    if (apiMode === "responses") {
      const result = await runResponsesRequest(
        partialCallback,
        partialThinkingCallback,
      );
      answer = result.answer;
      functionCalls = result.functionCalls;
      responseConversation.push(...result.output);
    } else {
      const result = await runChatCompletionsRequest(
        capturedImagePath,
        partialCallback,
        partialThinkingCallback,
      );
      answer = result.answer;
      reasoning = result.reasoning;
      functionCalls = result.functionCalls;
      serverToolCalls = result.serverToolCalls;
    }

    messages.push({
      role: "assistant",
      content: answer,
      tool_calls: isEmpty(functionCalls) ? undefined : functionCalls,
      reasoning_content: reasoning || undefined,
      server_tool_calls: serverToolCalls,
    });

    if (!isEmpty(functionCalls)) {
      const toolMessages = await executeFunctionCalls(
        functionCalls,
        invokeFunctionCallback,
      );
      await chatWithLLMStream(
        toolMessages,
        partialCallback,
        () => {
          endResolve();
          endCallback();
        },
        partialThinkingCallback,
        invokeFunctionCallback,
      );
      return;
    }
    endResolve();
    endCallback();
  } catch (error: any) {
    console.error(
      `[DeepSeek] request failed model=${deepseekLLMModel} api_mode=${apiMode}:`,
      error.message,
    );
    endResolve();
    throw error;
  }
  return promise;
};

const summaryTextWithLLM: SummaryTextWithLLMFunction = async (
  text,
  promptPrefix,
): Promise<string> => {
  if (!deepseek) return text;
  try {
    if (apiMode === "responses") {
      const response = await deepseek.responses.create({
        model: deepseekLLMModel,
        instructions: promptPrefix,
        input: text,
        reasoning: { effort: "none" },
      } as any);
      return response.output_text || text;
    }
    const response = await deepseek.chat.completions.create({
      model: deepseekLLMModel,
      messages: [
        { role: "system", content: promptPrefix },
        { role: "user", content: text },
      ],
      stream: false,
      ...({ thinking: { type: "disabled" } } as any),
    });
    return response.choices[0]?.message?.content || text;
  } catch (error: any) {
    console.error("[DeepSeek] Summary request failed:", error.message);
    return text;
  }
};

export default { chatWithLLMStream, resetChatHistory, summaryTextWithLLM };
