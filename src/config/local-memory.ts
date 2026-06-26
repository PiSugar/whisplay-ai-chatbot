import fs from "fs";
import path from "path";
import moment from "moment";
import { LLMTool, ToolReturnTag } from "../type";
import { dataDir } from "../utils/dir";

type MemoryExchange = {
  at: string;
  user: string;
  assistant: string;
};

type MemorySession = {
  id: string;
  title: string;
  summary: string;
  summaryUpdatedAt?: string;
  startedAt: string;
  updatedAt: string;
  exchanges: MemoryExchange[];
  keywords: string[];
};

type UserMemory = {
  id: string;
  kind: "preference" | "context" | "fact";
  content: string;
  createdAt: string;
  updatedAt: string;
  keywords: string[];
};

type MemoryStore = {
  version: 1;
  sessions: MemorySession[];
  userMemories: UserMemory[];
};

const memoryEnabled = (process.env.MEMORY_ENABLED || "").toLowerCase() === "true";
const memoryAutoSave = process.env.MEMORY_AUTO_SAVE !== "false" && memoryEnabled;
const memoryDir = path.resolve(
  process.env.MEMORY_DIR || path.join(dataDir, "memory"),
);
const memoryStorePath = path.join(memoryDir, "memory.json");
const memoryMaxSessions = parseInt(process.env.MEMORY_MAX_SESSIONS || "200", 10);
const memoryMaxSessionExchanges = parseInt(
  process.env.MEMORY_MAX_SESSION_EXCHANGES || "20",
  10,
);
const memoryMaxSearchResults = parseInt(
  process.env.MEMORY_MAX_SEARCH_RESULTS || "4",
  10,
);
const memoryWakeupMaxItems = parseInt(process.env.MEMORY_WAKEUP_MAX_ITEMS || "5", 10);
const memoryProfileText = (process.env.MEMORY_PROFILE_TEXT || "").trim();
const memorySummaryPromptPrefix =
  process.env.MEMORY_SUMMARY_PROMPT_PREFIX ||
  "请把下面这段用户与助手的对话整理成可供下次召回使用的简短中文记忆摘要。保留用户偏好、事实、决定、未完成事项和重要上下文；不要逐字复述原文；80字以内：";
const memorySessionIdleMs =
  parseInt(
    process.env.MEMORY_SESSION_IDLE_SECONDS ||
      process.env.CHAT_HISTORY_RESET_TIME ||
      "300",
    10,
  ) * 1000;

let activeSessionId = "";
let lastExchangeAt = 0;
let writeQueue: Promise<void> = Promise.resolve();
let recalledMemoryKeys = new Set<string>();
let recalledMemoryTexts = new Map<string, string>();

const nowIso = (): string => new Date().toISOString();

const ensureMemoryDir = (): void => {
  if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
};

const emptyStore = (): MemoryStore => ({
  version: 1,
  sessions: [],
  userMemories: [],
});

const makeId = (prefix: string): string =>
  `${prefix}_${moment().format("YYYYMMDD_HHmmss")}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

const textPreview = (text: string, max = 220): string => {
  const compactText = text.replace(/\s+/g, " ").trim();
  return compactText.length > max
    ? `${compactText.slice(0, Math.max(0, max - 1))}...`
    : compactText;
};

const uniqueStrings = (items: string[]): string[] =>
  Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));

const searchTokens = (text: string): string[] => {
  const lower = text.toLowerCase();
  const words = lower.match(/[\p{L}\p{N}_-]+/gu) || [];
  const chineseChunks = lower.match(/[\p{Script=Han}]{2,}/gu) || [];
  const grams = chineseChunks.flatMap((chunk) => {
    const result: string[] = [];
    for (let i = 0; i < chunk.length - 1; i += 1) {
      result.push(chunk.slice(i, i + 2));
    }
    return result;
  });
  return uniqueStrings([...words, ...grams]).filter((item) => item.length > 1);
};

const persistedKeywords = (text: string): string[] => {
  const lower = text.toLowerCase();
  const shortPhrases = lower
    .split(/[。！？!?，,；;\n\r]+/)
    .map((item) => textPreview(item, 24))
    .filter((item) => item.length >= 4 && /[\p{L}\p{N}]/u.test(item));
  const asciiWords = lower.match(/[a-z0-9][a-z0-9_-]{2,}/g) || [];
  const numericTerms = lower.match(/[a-z]*\d+(?:\.\d+)?%?/g) || [];
  const chinesePhrases = (lower.match(/[\p{Script=Han}]{4,}/gu) || [])
    .map((item) => textPreview(item, 24))
    .filter((item) => item.length >= 4);
  return uniqueStrings([...shortPhrases, ...asciiWords, ...numericTerms, ...chinesePhrases])
    .filter((item) => item.length >= 3)
    .slice(0, 24);
};

const normalizeStoreKeywords = (store: MemoryStore): MemoryStore => {
  store.sessions.forEach((session) => {
    if (session.summary) {
      session.title = titleFromSummary(session.summary, session.title);
    }
    session.keywords = persistedKeywords(
      [session.title, session.summary, ...session.exchanges.map((exchange) => exchange.user)]
        .filter(Boolean)
        .join("\n"),
    );
  });
  store.userMemories.forEach((memory) => {
    memory.keywords = persistedKeywords(memory.content);
  });
  return store;
};

const readStore = (): MemoryStore => {
  if (!memoryEnabled) return emptyStore();
  ensureMemoryDir();
  if (!fs.existsSync(memoryStorePath)) return emptyStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(memoryStorePath, "utf8"));
    return normalizeStoreKeywords({
      version: 1,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      userMemories: Array.isArray(parsed.userMemories) ? parsed.userMemories : [],
    });
  } catch (error: any) {
    console.error(`[Memory] Failed to read ${memoryStorePath}: ${error.message}`);
    return emptyStore();
  }
};

const writeStore = (store: MemoryStore): void => {
  ensureMemoryDir();
  const normalized = normalizeStoreKeywords(store);
  const trimmed: MemoryStore = {
    version: 1,
    sessions: normalized.sessions
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, memoryMaxSessions)),
    userMemories: normalized.userMemories,
  };
  fs.writeFileSync(memoryStorePath, `${JSON.stringify(trimmed, null, 2)}\n`);
};

const enqueueWrite = (fn: () => void | Promise<void>): void => {
  writeQueue = writeQueue
    .then(() => fn())
    .catch((error) => console.error(`[Memory] Write failed: ${error.message}`));
};

const titleFromText = (text: string): string => {
  const clean = textPreview(text, 36).replace(/[。！？!?，,：:；;]+$/g, "");
  return clean || "未命名对话";
};

const titleFromSummary = (summary: string, fallback: string): string => {
  const normalized = summary
    .replace(/\s+/g, " ")
    .replace(/^(用户)?(查询|询问|提问|想知道|讨论|聊到|关注|偏好)[：:，,\s]*/i, "")
    .replace(/^上次(聊|讨论|提到)[：:，,\s]*/i, "")
    .trim();
  const firstSentence = normalized
    .split(/[。！？!?；;\n\r]/)[0]
    .trim();
  const colonTopic = firstSentence.split(/[：:]/)[0]?.trim();
  const firstClause = (colonTopic && colonTopic.length >= 4 ? colonTopic : firstSentence)
    .split(/[，,]/)
    .map((item) => item.trim())
    .find((item) => item.length >= 4) || firstSentence || normalized;
  const title = titleFromText(firstClause);
  if (title === "未命名对话") return fallback;
  return title;
};

const buildHeuristicSessionSummary = (session: MemorySession): string => {
  const userTexts = session.exchanges
    .slice(-5)
    .map((exchange) => textPreview(exchange.user, 90));
  const assistantTexts = session.exchanges
    .slice(-3)
    .map((exchange) => textPreview(exchange.assistant, 90));
  return textPreview(
    [
      userTexts.length > 0 ? `用户近期主题：${userTexts.join("；")}` : "",
      assistantTexts.length > 0 ? `助手已回应：${assistantTexts.join("；")}` : "",
    ]
      .filter(Boolean)
      .join("。"),
    420,
  );
};

const buildSessionSummary = async (
  session: MemorySession,
  summaryText?: (text: string, promptPrefix: string) => Promise<string>,
): Promise<string> => {
  const fallback = buildHeuristicSessionSummary(session);
  if (!summaryText) return fallback;

  const transcript = session.exchanges
    .slice(-6)
    .map((exchange) => `用户：${exchange.user}\n助手：${exchange.assistant}`)
    .join("\n\n");
  if (!transcript.trim()) return fallback;

  try {
    const summary = await summaryText(transcript, memorySummaryPromptPrefix);
    const normalizedSummary = (summary || "").trim();
    const looksLikeTranscript =
      normalizedSummary === transcript.trim() ||
      (/用户[：:]/.test(normalizedSummary) && /助手[：:]/.test(normalizedSummary));
    return textPreview(!normalizedSummary || looksLikeTranscript ? fallback : normalizedSummary, 600);
  } catch (error: any) {
    console.error(`[Memory] Summary generation failed: ${error.message}`);
    return fallback;
  }
};

const getActiveSession = (store: MemoryStore, userText: string): MemorySession => {
  const shouldStartNew =
    !activeSessionId ||
    (lastExchangeAt > 0 && Date.now() - lastExchangeAt > memorySessionIdleMs);
  if (!shouldStartNew) {
    const found = store.sessions.find((session) => session.id === activeSessionId);
    if (found) return found;
  }

  recalledMemoryKeys = new Set<string>();
  recalledMemoryTexts = new Map<string, string>();
  const session: MemorySession = {
    id: makeId("session"),
    title: titleFromText(userText),
    summary: "",
    startedAt: nowIso(),
    updatedAt: nowIso(),
    exchanges: [],
    keywords: persistedKeywords(userText),
  };
  activeSessionId = session.id;
  store.sessions.unshift(session);
  console.log(`[Memory] Started session: ${session.title}`);
  return session;
};

const scoreText = (query: string, text: string, keywords: string[] = []): number => {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  let score = lowerText.includes(lowerQuery) && lowerQuery.length > 1 ? 4 : 0;
  for (const token of searchTokens(query)) {
    if (lowerText.includes(token)) score += 2;
    if (keywords.includes(token)) score += 2;
  }
  return score;
};

type SearchResult = {
  key: string;
  score: number;
  text: string;
};

const buildSearchMatches = (query: string): SearchResult[] => {
  if (!memoryEnabled || !query.trim()) return [];
  const store = readStore();
  const memoryMatches = store.userMemories
    .map((memory) => ({
      key: `user:${memory.id}`,
      score: scoreText(query, memory.content, memory.keywords),
      text: `用户记忆/${memory.kind}: ${memory.content}`,
    }))
    .filter((item) => item.score > 0);
  const sessionMatches = store.sessions
    .filter((session) => session.id !== activeSessionId)
    .map((session) => {
      const body = [
        session.title,
        session.summary,
        ...session.exchanges.slice(-6).map((exchange) => `${exchange.user}\n${exchange.assistant}`),
      ].join("\n");
      return {
        key: `session:${session.id}`,
        score: scoreText(query, body, session.keywords),
        text: `历史对话《${session.title}》（${session.updatedAt.slice(0, 10)}）摘要: ${
          session.summary || "这段对话的摘要还在生成中，暂不使用原始对话内容。"
        }`,
      };
    })
    .filter((item) => item.score > 0);

  return [...memoryMatches, ...sessionMatches].sort((a, b) => b.score - a.score) as SearchResult[];
};

const markRecalled = (items: SearchResult[]): void => {
  items.forEach((item) => {
    recalledMemoryKeys.add(item.key);
    recalledMemoryTexts.set(item.key, item.text);
  });
};

const searchStore = (query: string, mark = true): string[] => {
  const results = buildSearchMatches(query)
    .filter((item) => !recalledMemoryKeys.has(item.key))
    .slice(0, Math.max(1, memoryMaxSearchResults));

  if (mark) {
    markRecalled(results);
  }

  return results.map((item) => item.text);
};

const searchStoreForTool = (query: string): string => {
  const matches = buildSearchMatches(query);
  const fresh = matches
    .filter((item) => !recalledMemoryKeys.has(item.key))
    .slice(0, Math.max(1, memoryMaxSearchResults));
  if (fresh.length > 0) {
    markRecalled(fresh);
    return fresh.map((item) => item.text).join("\n");
  }

  const alreadyRecalled = matches
    .filter((item) => recalledMemoryKeys.has(item.key))
    .slice(0, Math.max(1, memoryMaxSearchResults))
    .map((item) => recalledMemoryTexts.get(item.key) || item.text);
  if (alreadyRecalled.length > 0) {
    return [
      "Memory already recalled.",
      ...alreadyRecalled.map((item) => `Recalled: ${item}`),
    ].join("\n");
  }

  return "No local memories found.";
};

const shouldSearchHistory = (userText: string): boolean =>
  /之前|上次|以前|刚才|历史|记得|回忆|聊过|说过|提到|last time|previous|before|remember/i.test(
    userText,
  );

const inferPreference = (userText: string): string => {
  const text = textPreview(userText, 240);
  if (/记住|以后|偏好|我喜欢|我不喜欢|我希望|不要|别再|下次/.test(text)) {
    return text;
  }
  return "";
};

export const prepareMemoryPrompt = (userText: string): string => {
  if (!memoryEnabled) return "";
  const store = readStore();
  getActiveSession(store, userText);
  writeStore(store);

  const wakeupItems = store.userMemories
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter((memory) => !recalledMemoryKeys.has(`user:${memory.id}`))
    .slice(0, Math.max(0, memoryWakeupMaxItems))
    .map((memory) => {
      const text = `用户记忆/${memory.kind}: ${memory.content}`;
      markRecalled([{ key: `user:${memory.id}`, score: 0, text }]);
      return `- ${memory.content}`;
    });
  const searchResults = shouldSearchHistory(userText) ? searchStore(userText) : [];
  const sections = [
    memoryProfileText ? `固定用户画像/偏好：\n${memoryProfileText}` : "",
    wakeupItems.length > 0 ? `简短偏好/情景记忆：\n${wakeupItems.join("\n")}` : "",
    searchResults.length > 0
      ? `可能相关的历史对话记忆：\n${searchResults.map((item) => `- ${item}`).join("\n")}`
      : "",
  ].filter(Boolean);

  if (sections.length === 0) return "";
  return [
    "以下是本地轻量记忆模块提供的上下文。自然使用这些信息；如果历史记忆不确定，不要编造。",
    ...sections,
  ].join("\n\n");
};

export function autoSaveExchange(
  userText: string,
  assistantText: string,
  summaryText?: (text: string, promptPrefix: string) => Promise<string>,
): void {
  if (!memoryAutoSave) return;
  if (!userText.trim() || !assistantText.trim()) return;

  enqueueWrite(async () => {
    const store = readStore();
    const session = getActiveSession(store, userText);
    const exchange: MemoryExchange = {
      at: nowIso(),
      user: textPreview(userText, 1200),
      assistant: textPreview(assistantText, 1600),
    };
    session.exchanges.push(exchange);
    session.exchanges = session.exchanges.slice(-Math.max(1, memoryMaxSessionExchanges));
    if (session.exchanges.length === 1) {
      session.title = titleFromText(userText);
    }
    session.summary = await buildSessionSummary(session, summaryText);
    session.summaryUpdatedAt = nowIso();
    const summaryTitle = titleFromSummary(session.summary, session.title);
    if (summaryTitle && summaryTitle !== session.title) {
      session.title = summaryTitle;
    }
    session.keywords = persistedKeywords(
      [session.title, session.summary, userText, assistantText].join("\n"),
    );
    session.updatedAt = nowIso();
    lastExchangeAt = Date.now();

    const preference = inferPreference(userText);
    if (preference) {
      const existing = store.userMemories.find((memory) => memory.content === preference);
      if (existing) {
        existing.updatedAt = nowIso();
      } else {
        store.userMemories.unshift({
          id: makeId("memory"),
          kind: "preference",
          content: preference,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          keywords: persistedKeywords(preference),
        });
      }
    }

    writeStore(store);
    console.log(`[Memory] Saved exchange to: ${session.title}`);
  });
}

export const localMemoryTools: LLMTool[] = [];

if (memoryEnabled) {
  console.log(`[Memory] Enabled, store: ${memoryStorePath}`);
  localMemoryTools.push(
    {
      type: "function",
      function: {
        name: "searchLocalMemory",
        description:
          "Search local lightweight memory for user preferences, situations, and previous conversations. Use it when the user refers to earlier chats or asks what was discussed before.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "What to search for in local memory",
            },
          },
          required: ["query"],
        },
      },
      func: async (params: { query: string }) => {
        return `${ToolReturnTag.Success}${searchStoreForTool(params.query)}`;
      },
    },
    {
      type: "function",
      function: {
        name: "storeLocalMemory",
        description:
          "Store a concise user preference, situation, or durable fact in local lightweight memory.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "A concise durable memory to remember later",
            },
            kind: {
              type: "string",
              description: "Memory type",
              enum: ["preference", "context", "fact"],
            },
          },
          required: ["content"],
        },
      },
      func: async (params: { content: string; kind?: "preference" | "context" | "fact" }) => {
        const content = textPreview(params.content || "", 300);
        if (!content) return `${ToolReturnTag.Error}Memory content is empty.`;
        enqueueWrite(() => {
          const store = readStore();
          store.userMemories.unshift({
            id: makeId("memory"),
            kind: params.kind || "fact",
            content,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            keywords: persistedKeywords(content),
          });
          writeStore(store);
        });
        return `${ToolReturnTag.Success}Stored local memory.`;
      },
    },
  );
}

export const addLocalMemoryTools = (tools: LLMTool[]): void => {
  if (localMemoryTools.length > 0) {
    console.log(
      `[Memory] Adding ${localMemoryTools.length} tool(s): ${localMemoryTools
        .map((tool) => tool.function.name)
        .join(", ")}`,
    );
    tools.push(...localMemoryTools);
  }
};
