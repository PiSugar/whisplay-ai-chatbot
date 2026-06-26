import { Message, OllamaMessage } from "../type";

type ChatMessage = Message | OllamaMessage;

type ContextWindowOptions = {
  provider: string;
  model: string;
  messages: ChatMessage[];
  tools?: unknown;
  outputReserveTokens?: number;
  contextWindowResolver?: () => Promise<number | undefined>;
  invokeFunctionCallback?: (functionName: string, result?: string) => void;
};

const SUMMARY_MARKER = "[Earlier conversation summary]";
const DEFAULT_CONTEXT_WINDOW = 8_192;
const DEFAULT_OUTPUT_RESERVE_TOKENS = 1_024;
const DEFAULT_REMAINING_RATIO = 0.2;
const DEFAULT_TARGET_REMAINING_RATIO = 0.45;
const DEFAULT_SUMMARY_CHARS = 6_000;
const CHARS_PER_TOKEN = 4;

const contextLimitCache = new Map<string, number>();

const parseBoolEnv = (key: string, defaultValue = false): boolean => {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  return raw.toLowerCase() === "true" || raw === "1";
};

const isContextCompactionEnabled = (): boolean => {
  return parseBoolEnv("CONTEXT_AUTO_COMPACT_ENABLED", true);
};

const inferContextWindowFromModel = (provider: string, model: string): number => {
  const normalized = model.toLowerCase();
  if (normalized.includes("gpt-4.1")) return 1_047_576;
  if (normalized.includes("gpt-5")) return 400_000;
  if (normalized.includes("o3") || normalized.includes("o4")) return 200_000;
  if (normalized.includes("128k")) return 128_000;
  if (normalized.includes("32k")) return 32_000;
  if (normalized.includes("16k")) return 16_000;
  if (normalized.includes("8k")) return 8_192;
  if (normalized.includes("4k")) return 4_096;
  if (normalized.includes("1m")) return 1_000_000;
  if (normalized.includes("gpt-4o")) return 128_000;
  if (normalized.includes("qwen") && normalized.includes("long")) {
    return 128_000;
  }
  if (normalized.includes("deepseek") || normalized.includes("llama")) {
    return provider === "ollama" ? DEFAULT_CONTEXT_WINDOW : 32_000;
  }
  return 0;
};

export const getModelContextWindow = async (
  provider: string,
  model: string,
  resolver?: () => Promise<number | undefined>,
): Promise<number> => {
  const cacheKey = `${provider}:${model}`;
  const cached = contextLimitCache.get(cacheKey);
  if (cached) return cached;

  let resolvedLimit = 0;
  if (resolver) {
    try {
      resolvedLimit = (await resolver()) || 0;
    } catch (error: any) {
      console.log(
        `[ContextWindow] failed to resolve provider context window, using default=${DEFAULT_CONTEXT_WINDOW}: ${error.message}`,
      );
      contextLimitCache.set(cacheKey, DEFAULT_CONTEXT_WINDOW);
      return DEFAULT_CONTEXT_WINDOW;
    }
    if (!resolvedLimit) {
      console.log(
        `[ContextWindow] provider context window unavailable, using default=${DEFAULT_CONTEXT_WINDOW}`,
      );
      contextLimitCache.set(cacheKey, DEFAULT_CONTEXT_WINDOW);
      return DEFAULT_CONTEXT_WINDOW;
    }
  }
  const limit =
    resolvedLimit || inferContextWindowFromModel(provider, model) || DEFAULT_CONTEXT_WINDOW;
  contextLimitCache.set(cacheKey, limit);
  console.log(
    `[ContextWindow] provider=${provider} model=${model} context_window=${limit}`,
  );
  return limit;
};

const invokeCallbackSafely = (
  callback: ContextWindowOptions["invokeFunctionCallback"],
  functionName: string,
  result?: string,
): void => {
  try {
    callback?.(functionName, result);
  } catch (error: any) {
    console.log(`[ContextWindow] display callback failed: ${error.message}`);
  }
};

const textFromContent = (content: unknown): string => {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content) || "";
  } catch {
    return "";
  }
};

const estimateTokens = (value: unknown): number => {
  return Math.ceil(textFromContent(value).length / CHARS_PER_TOKEN);
};

const estimateMessageTokens = (message: ChatMessage): number => {
  return (
    4 +
    estimateTokens(message.content) +
    estimateTokens((message as Message).tool_calls) +
    estimateTokens((message as Message).tool_call_id) +
    estimateTokens((message as OllamaMessage).tool_name)
  );
};

const estimateMessagesTokens = (messages: ChatMessage[]): number => {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
};

const formatSummaryLine = (message: ChatMessage): string => {
  const prefix =
    message.role === "tool"
      ? `tool${(message as OllamaMessage).tool_name ? `:${(message as OllamaMessage).tool_name}` : ""}`
      : message.role;
  const content = textFromContent(message.content).replace(/\s+/g, " ").trim();
  return `${prefix}: ${content.slice(0, 600)}`;
};

const findExistingSummaryIndex = (messages: ChatMessage[]): number => {
  return messages.findIndex(
    (message, index) =>
      index > 0 &&
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.startsWith(SUMMARY_MARKER),
  );
};

const buildCompactedSummary = (
  existingSummary: string,
  compactedMessages: ChatMessage[],
  maxChars: number,
): string => {
  if (maxChars <= 0) return SUMMARY_MARKER;
  const previous = existingSummary
    ? existingSummary.replace(SUMMARY_MARKER, "").trim()
    : "";
  const lines = compactedMessages
    .filter((message) => message.role !== "system")
    .map(formatSummaryLine)
    .filter(Boolean);
  const combined = [previous, ...lines].filter(Boolean).join("\n");
  const trimmed =
    combined.length > maxChars
      ? combined.slice(combined.length - maxChars)
      : combined;
  return `${SUMMARY_MARKER}\n${trimmed}`;
};

const chooseTailStart = (
  messages: ChatMessage[],
  maxTailTokens: number,
): number => {
  let used = 0;
  let start = messages.length;
  for (let index = messages.length - 1; index > 0; index -= 1) {
    if (
      messages[index].role === "system" &&
      typeof messages[index].content === "string" &&
      messages[index].content.startsWith(SUMMARY_MARKER)
    ) {
      continue;
    }
    const nextUsed = used + estimateMessageTokens(messages[index]);
    if (nextUsed > maxTailTokens && start < messages.length) break;
    used = nextUsed;
    start = index;
  }

  while (start > 1 && messages[start]?.role === "tool") {
    start -= 1;
  }

  return Math.max(1, start);
};

export const compactMessagesForContextWindow = async (
  options: ContextWindowOptions,
): Promise<void> => {
  try {
    await compactMessagesForContextWindowUnsafe(options);
  } catch (error: any) {
    console.log(
      `[ContextWindow] compaction skipped after error, continuing chat: ${error.message}`,
    );
  }
};

const compactMessagesForContextWindowUnsafe = async (
  options: ContextWindowOptions,
): Promise<void> => {
  if (!isContextCompactionEnabled()) return;

  const { provider, model, messages, tools } = options;
  if (messages.length <= 2) return;

  const contextWindow = await getModelContextWindow(
    provider,
    model,
    options.contextWindowResolver,
  );
  const outputReserveTokens =
    options.outputReserveTokens || DEFAULT_OUTPUT_RESERVE_TOKENS;
  const toolTokens = tools ? estimateTokens(tools) : 0;
  const usedTokens = estimateMessagesTokens(messages) + toolTokens + outputReserveTokens;
  const remainingTokens = contextWindow - usedTokens;
  const remainingRatio = remainingTokens / contextWindow;

  if (remainingRatio >= DEFAULT_REMAINING_RATIO) return;

  const targetUsedTokens = Math.max(
    512,
    Math.floor(contextWindow * (1 - DEFAULT_TARGET_REMAINING_RATIO)) -
      toolTokens -
      outputReserveTokens,
  );
  const summaryIndex = findExistingSummaryIndex(messages);
  const existingSummary =
    summaryIndex > 0 ? textFromContent(messages[summaryIndex].content) : "";
  const stableSystemMessage = messages[0];
  const tailStart = chooseTailStart(messages, targetUsedTokens);
  const compactedMessages = messages
    .slice(1, tailStart)
    .filter((message, index) => summaryIndex !== index + 1);
  const tailMessages = messages.slice(tailStart);
  const summaryBudgetTokens = Math.max(
    0,
    targetUsedTokens -
      estimateMessageTokens(stableSystemMessage) -
      estimateMessagesTokens(tailMessages),
  );
  const summary = buildCompactedSummary(
    existingSummary,
    compactedMessages,
    Math.min(
      DEFAULT_SUMMARY_CHARS,
      summaryBudgetTokens * CHARS_PER_TOKEN,
    ),
  );

  invokeCallbackSafely(options.invokeFunctionCallback, "compactHistory");
  messages.length = 0;
  messages.push(stableSystemMessage);
  if (summary.trim() !== SUMMARY_MARKER) {
    messages.push({
      role: "system",
      content: summary,
    } as ChatMessage);
  }
  messages.push(...tailMessages);

  const nextUsedTokens =
    estimateMessagesTokens(messages) + toolTokens + outputReserveTokens;
  console.log(
    `[ContextWindow] compacted provider=${provider} model=${model} before_tokens=${usedTokens} after_tokens=${nextUsedTokens} context_window=${contextWindow}`,
  );
  invokeCallbackSafely(
    options.invokeFunctionCallback,
    "compactHistory",
    `[success] compacted before_tokens=${usedTokens} after_tokens=${nextUsedTokens}`,
  );
};
