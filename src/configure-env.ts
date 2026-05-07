import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import readline from "readline";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";

type EnvMap = Record<string, string>;

type TemplateEntry = {
  key: string;
  defaultValue: string;
  commented: boolean;
  sectionTitle: string;
  comments: string[];
  options: string[];
};

type TemplateSection = {
  title: string;
  entries: TemplateEntry[];
};

type MenuItem<T> = {
  label: string;
  value: T;
  hint?: string;
};

type TopLevelGroup = {
  key: string;
  title: string;
  description: string;
  matches: (section: TemplateSection) => boolean;
};

type SectionMenuNode = {
  title: string;
  hint: string;
  kind: "section" | "folder";
  section?: TemplateSection;
  sections?: TemplateSection[];
};

const envTemplatePath = path.resolve(__dirname, "..", ".env.template");
const envPath = path.resolve(__dirname, "..", ".env");
const envBackupDir = path.resolve(__dirname, "..", ".env.backups");
const defaultSectionTitle = "Core";

const rl = createInterface({ input, output });

const color = {
  green: (text: string) => `\x1b[0;32m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[0;33m${text}\x1b[0m`,
  red: (text: string) => `\x1b[0;31m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[0;36m${text}\x1b[0m`,
};

const activeLinePattern = /^([A-Z0-9_]+)=(.*)$/;
const commentedLinePattern = /^#\s*([A-Z0-9_]+)=(.*)$/;

const topLevelGroups: TopLevelGroup[] = [
  {
    key: "core",
    title: "Core",
    description: "Primary provider selection and the most important startup settings.",
    matches: (section) => section.title === "Core",
  },
  {
    key: "providers-cloud",
    title: "Cloud Providers",
    description: "OpenAI, Gemini, Tencent, VolcEngine, Anthropic, Qwen and other cloud APIs.",
    matches: (section) =>
      [
        "Tencent Cloud ASR and TTS",
        "ByteDance VolcEngine ASR and TTS",
        "ByteDance Doubao LLM",
        "Google Gemini",
        "Gemini Image Generation",
        "OpenAI",
        "OpenAI TTS",
        "Grok",
        "Anthropic",
        "MiniMax",
        "Kimi (Moonshot AI)",
        "Alibaba Cloud Qwen (通义千问)",
        "OpenRouter",
        "Perplexity",
      ].includes(section.title),
  },
  {
    key: "providers-local",
    title: "Local Providers",
    description: "Ollama, Whisper, Piper, Vosk, Picovoice and other on-device services.",
    matches: (section) =>
      [
        "Ollama",
        "Piper TTS",
        "espeak-ng TTS",
        "Piper HTTP TTS",
        "Vosk ASR",
        "Whisper ASR & Whisper HTTP Server",
        "Faster Whisper ASR",
        "Supertonic TTS",
        "Raspberry Pi AI Hat+ 2 (Hailo-10H)",
        "LLM8850",
        "Picovoice (Leopard ASR + Orca TTS)",
      ].includes(section.title),
  },
  {
    key: "ai-features",
    title: "AI Features",
    description: "Wake word, camera, RAG, web search, memory and local tools.",
    matches: (section) =>
      [
        "Wake word",
        "Pi Camera",
        "RAG Settings",
        "RAG Providers & Storage",
        "Conversation & Runtime",
        "Web Search",
        "Tavily Search API",
        "SerpAPI (Google Search via SerpAPI)",
        "Bing Search API",
        "Google Custom Search API",
        "Local Music Tool (LLM function calling)",
        "MemPalace (Long-term AI Memory)",
        "AI Behavior",
      ].includes(section.title),
  },
  {
    key: "device-ui",
    title: "Device & UI",
    description: "Display, audio, camera simulation, icons and device presentation settings.",
    matches: (section) =>
      [
        "VPN Status Icon",
        "Default Emoji",
        "Custom Font",
        "Initial Volume Level",
        "Web Display Settings",
        "Web Audio Settings (requires WHISPLAY_WEB_ENABLED=true)",
        "Web Camera Settings (requires WHISPLAY_WEB_ENABLED=true)",
      ].includes(section.title),
  },
  {
    key: "integration-network",
    title: "Integration & Network",
    description: "Proxy and bridge integrations.",
    matches: (section) =>
      ["Proxy Settings", "Whisplay IM bridge (use OpenClaw as IM backend)"].includes(section.title),
  },
  {
    key: "advanced",
    title: "Advanced",
    description: "Less-common settings and any uncategorized sections.",
    matches: () => false,
  },
];

const entryDisplayNameMap: Record<string, string> = {
  SYSTEM_PROMPT: "Prompt",
};

function getEntryDisplayName(key: string): string {
  return entryDisplayNameMap[key] || key;
}

function maskValue(key: string, value: string): string {
  if (!value) return "(empty)";
  if (/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key)) {
    if (value.length <= 4) return "*".repeat(value.length);
    return `${value.slice(0, 2)}${"*".repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`;
  }
  return value;
}

function parseOptions(comments: string[]): string[] {
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    const match = comments[i].match(/options:\s*(.+)$/i);
    if (!match) continue;

    return match[1]
      .split(",")
      .map((item) => item.trim().replace(/^`|`$/g, ""))
      .filter(Boolean);
  }

  return [];
}

function isBooleanEntry(entry: TemplateEntry, currentValue: string | undefined): boolean {
  if (currentValue === "true" || currentValue === "false") return true;
  if (entry.defaultValue === "true" || entry.defaultValue === "false") return true;
  return entry.comments.some((comment) => /\btrue\b|\bfalse\b/i.test(comment));
}

function parseTemplate(): TemplateSection[] {
  const lines = fs.readFileSync(envTemplatePath, "utf-8").split("\n");
  const sections = new Map<string, TemplateSection>();
  let currentSectionTitle = defaultSectionTitle;
  let pendingComments: string[] = [];

  const ensureSection = (title: string): TemplateSection => {
    const existing = sections.get(title);
    if (existing) return existing;
    const created: TemplateSection = { title, entries: [] };
    sections.set(title, created);
    return created;
  };

  ensureSection(currentSectionTitle);

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("## ")) {
      currentSectionTitle = line.slice(3).trim() || defaultSectionTitle;
      ensureSection(currentSectionTitle);
      pendingComments = [];
      continue;
    }

    if (!line.trim()) {
      pendingComments = [];
      continue;
    }

    const activeMatch = rawLine.match(activeLinePattern);
    const commentedMatch = rawLine.match(commentedLinePattern);
    const match = activeMatch || commentedMatch;

    if (match) {
      const [, key, defaultValue] = match;
      ensureSection(currentSectionTitle).entries.push({
        key,
        defaultValue,
        commented: Boolean(commentedMatch),
        sectionTitle: currentSectionTitle,
        comments: [...pendingComments],
        options: parseOptions(pendingComments),
      });
      pendingComments = [];
      continue;
    }

    if (line.startsWith("#")) {
      pendingComments.push(line.replace(/^#\s?/, "").trim());
    } else {
      pendingComments = [];
    }
  }

  return Array.from(sections.values()).filter((section) => section.entries.length > 0);
}

function buildGroupedSections(sections: TemplateSection[]): Array<{
  group: TopLevelGroup;
  sections: TemplateSection[];
}> {
  const consumed = new Set<string>();
  const grouped = topLevelGroups
    .map((group) => {
      if (group.key === "advanced") {
        return { group, sections: [] as TemplateSection[] };
      }
      const matched = sections.filter((section) => group.matches(section));
      matched.forEach((section) => consumed.add(section.title));
      return { group, sections: matched };
    })
    .filter((item) => item.sections.length > 0 || item.group.key === "advanced");

  const remaining = sections.filter((section) => !consumed.has(section.title));
  const advancedGroup = grouped.find((item) => item.group.key === "advanced");
  if (advancedGroup) {
    advancedGroup.sections = remaining;
  }

  return grouped.filter((item) => item.sections.length > 0);
}

function loadEnvMap(): EnvMap {
  if (!fs.existsSync(envPath)) return {};
  return dotenv.parse(fs.readFileSync(envPath));
}

function normalizeEnvMap(rawEnvMap: EnvMap, sections: TemplateSection[]): EnvMap {
  const normalized: EnvMap = { ...rawEnvMap };

  sections.forEach((section) => {
    section.entries.forEach((entry) => {
      if (!entry.commented && normalized[entry.key] === entry.defaultValue) {
        delete normalized[entry.key];
      }
    });
  });

  return normalized;
}

function getEffectiveValue(entry: TemplateEntry, envMap: EnvMap): string | undefined {
  if (envMap[entry.key] !== undefined) {
    return envMap[entry.key];
  }

  if (!entry.commented) {
    return entry.defaultValue;
  }

  return undefined;
}

function isConfigured(entry: TemplateEntry, envMap: EnvMap): boolean {
  return envMap[entry.key] !== undefined;
}

function saveEnvMap(envMap: EnvMap): void {
  const templateLines = fs.readFileSync(envTemplatePath, "utf-8").split("\n");
  const knownKeys = new Set<string>();

  const nextLines = templateLines.map((line) => {
    const activeMatch = line.match(activeLinePattern);
    if (activeMatch) {
      const key = activeMatch[1];
      knownKeys.add(key);
      if (envMap[key] !== undefined) return `${key}=${envMap[key]}`;
      return line;
    }

    const commentedMatch = line.match(commentedLinePattern);
    if (commentedMatch) {
      const key = commentedMatch[1];
      knownKeys.add(key);
      if (envMap[key] !== undefined) return `${key}=${envMap[key]}`;
      return line;
    }

    return line;
  });

  const extraKeys = Object.keys(envMap).filter((key) => !knownKeys.has(key));
  if (extraKeys.length > 0) {
    nextLines.push("");
    nextLines.push("## The following keys are from your .env but not present in .env.template");
    extraKeys.forEach((key) => {
      nextLines.push(`${key}=${envMap[key]}`);
    });
  }

  fs.writeFileSync(envPath, `${nextLines.join("\n")}\n`);
}

function ensureBackup(): string | null {
  if (!fs.existsSync(envPath)) {
    return null;
  }

  fs.mkdirSync(envBackupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(envBackupDir, `.env.${timestamp}.bak`);
  fs.copyFileSync(envPath, backupPath);
  return backupPath;
}

function supportsArrowMenu(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

async function ask(prompt: string): Promise<string> {
  const answer = await rl.question(prompt);
  return answer.trim();
}

function clearAndRender(lines: string[]): void {
  readline.cursorTo(output, 0, 0);
  readline.clearScreenDown(output);
  output.write(`${lines.join("\n")}\n`);
}

async function selectWithArrows<T>(
  title: string,
  items: Array<MenuItem<T>>,
  options?: {
    subtitle?: string;
    initialIndex?: number;
    escapeValue?: T;
  },
): Promise<T> {
  if (items.length === 0) {
    throw new Error(`No menu items available for ${title}`);
  }

  if (!supportsArrowMenu()) {
    if (options?.subtitle) console.log(options.subtitle);
    console.log("");
    console.log(color.bold(title));
    items.forEach((item, index) => {
      const suffix = item.hint ? ` ${color.dim(item.hint)}` : "";
      console.log(`  ${index + 1}. ${item.label}${suffix}`);
    });
    const answer = await ask("> ");
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= items.length) {
      return items[index - 1].value;
    }
    throw new Error("Invalid selection.");
  }

  const previousRawMode = input.isRaw;
  readline.emitKeypressEvents(input);
  input.setRawMode?.(true);

  let selectedIndex = Math.max(0, Math.min(options?.initialIndex ?? 0, items.length - 1));

  const render = () => {
    const lines: string[] = [];
    lines.push(color.bold(title));
    if (options?.subtitle) lines.push(color.dim(options.subtitle));
    lines.push(color.dim("Use ↑/↓ to move, Enter to select."));
    lines.push("");

    items.forEach((item, index) => {
      const prefix = index === selectedIndex ? color.cyan("›") : " ";
      const label = index === selectedIndex ? color.cyan(item.label) : item.label;
      const hint = item.hint ? ` ${color.dim(item.hint)}` : "";
      lines.push(`${prefix} ${label}${hint}`);
    });

    clearAndRender(lines);
  };

  render();

  return await new Promise<T>((resolve, reject) => {
    const onKeypress = (_str: string, key: readline.Key) => {
      if (key.name === "up") {
        selectedIndex = selectedIndex === 0 ? items.length - 1 : selectedIndex - 1;
        render();
        return;
      }
      if (key.name === "down") {
        selectedIndex = selectedIndex === items.length - 1 ? 0 : selectedIndex + 1;
        render();
        return;
      }
      if (key.name === "return") {
        cleanup();
        resolve(items[selectedIndex].value);
        return;
      }
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup();
        if (options && "escapeValue" in options && options.escapeValue !== undefined) {
          resolve(options.escapeValue);
          return;
        }
        reject(new Error("Selection cancelled."));
      }
    };

    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.setRawMode?.(previousRawMode ?? false);
      output.write("\n");
    };

    input.on("keypress", onKeypress);
  });
}

function summarizeComment(entry: TemplateEntry): string {
  const line = entry.comments.find((comment) => comment.length > 0);
  return line || "No description available.";
}

function buildSectionMenuNodes(
  groupTitle: string,
  sections: TemplateSection[],
  envMap: EnvMap,
): SectionMenuNode[] {
  if (groupTitle !== "AI Features") {
    return sections.map((section) => {
      const configuredCount = section.entries.filter((entry) => isConfigured(entry, envMap)).length;
      return {
        title: section.title,
        hint: `${configuredCount}/${section.entries.length} configured`,
        kind: "section",
        section,
      };
    });
  }

  const isWebSearchProviderSection = (title: string): boolean =>
    title.startsWith("Tavily Search API") ||
    title.startsWith("SerpAPI") ||
    title.startsWith("Bing Search API") ||
    title.startsWith("Google Custom Search API");

  const providerSections = sections.filter((section) => isWebSearchProviderSection(section.title));
  const normalSections = sections.filter((section) => !isWebSearchProviderSection(section.title));

  const nodes: SectionMenuNode[] = normalSections.map((section) => {
    const configuredCount = section.entries.filter((entry) => isConfigured(entry, envMap)).length;
    return {
      title: section.title,
      hint: `${configuredCount}/${section.entries.length} configured`,
      kind: "section",
      section,
    };
  });

  if (providerSections.length > 0) {
    const configuredCount = providerSections.reduce(
      (sum, section) => sum + section.entries.filter((entry) => isConfigured(entry, envMap)).length,
      0,
    );
    const totalCount = providerSections.reduce((sum, section) => sum + section.entries.length, 0);
    const webSearchIndex = nodes.findIndex((node) => node.title === "Web Search");
    const folderNode: SectionMenuNode = {
      title: "Web Search Providers",
      hint: `${configuredCount}/${totalCount} configured`,
      kind: "folder",
      sections: providerSections,
    };

    if (webSearchIndex >= 0) {
      nodes.splice(webSearchIndex + 1, 0, folderNode);
    } else {
      nodes.push(folderNode);
    }
  }

  return nodes;
}

function buildEntrySubtitle(entry: TemplateEntry, envMap: EnvMap): string {
  const currentValue = getEffectiveValue(entry, envMap);
  const currentDisplay =
    currentValue === undefined ? "(commented / unset)" : maskValue(entry.key, currentValue);
  const templateDisplay = entry.defaultValue || "(empty)";
  const lines = [
    `Key: ${entry.key}`,
    `Description: ${summarizeComment(entry)}`,
    `Section: ${entry.sectionTitle}`,
    `Current: ${currentDisplay}`,
    `Template: ${entry.commented ? `(commented) ${templateDisplay}` : templateDisplay}`,
  ];

  if (entry.options.length > 0) {
    lines.push(`Options: ${entry.options.join(", ")}`);
  }

  return lines.join("\n");
}

function formatPath(pathItems: string[]): string {
  return pathItems.length > 0 ? pathItems.join(" > ") : "Home";
}

function withPath(pathItems: string[], details?: string): string {
  return details ? `Path: ${formatPath(pathItems)}\n${details}` : `Path: ${formatPath(pathItems)}`;
}

async function promptForValue(
  prompt: string,
  fallbackValue?: string,
): Promise<string | null> {
  const promptSuffix = fallbackValue !== undefined ? ` [default: ${fallbackValue}]` : "";
  const nextValue = await ask(`${prompt}${promptSuffix}: `);
  if (!nextValue) {
    if (fallbackValue !== undefined) {
      return fallbackValue;
    }
    console.log(color.yellow("Value not changed."));
    return null;
  }
  return nextValue;
}

async function editEntry(
  entry: TemplateEntry,
  envMap: EnvMap,
  persistEnvMap: () => void,
  pathItems: string[],
): Promise<"back" | "quit"> {
  while (true) {
    const currentValue = getEffectiveValue(entry, envMap);
    const inputDefaultValue =
      currentValue !== undefined ? currentValue : entry.commented ? entry.defaultValue : undefined;

    const booleanEntry = isBooleanEntry(entry, currentValue);
    const actions: Array<MenuItem<string>> = booleanEntry
      ? [
          { label: "Set true", value: "set-true" },
          { label: "Set false", value: "set-false" },
          { label: "Restore template default/commented state", value: "restore" },
          { label: "Custom value", value: "custom" },
          { label: "Back", value: "back" },
          { label: "Quit", value: "quit" },
        ]
      : [
          { label: "Edit value", value: "edit" },
          { label: "Restore template default/commented state", value: "restore" },
          { label: "Back", value: "back" },
          { label: "Quit", value: "quit" },
        ];

    const choice = await selectWithArrows(getEntryDisplayName(entry.key), actions, {
      subtitle: withPath(pathItems, buildEntrySubtitle(entry, envMap)),
      escapeValue: "back",
    });

    if (choice === "quit") return "quit";
    if (choice === "back") return "back";

    if (choice === "set-true") {
      envMap[entry.key] = "true";
    } else if (choice === "set-false") {
      envMap[entry.key] = "false";
    } else if (choice === "restore") {
      delete envMap[entry.key];
    } else if (choice === "custom" || choice === "edit") {
      if (entry.options.length > 0 && choice === "edit") {
        const optionChoice = await selectWithArrows(
          `${getEntryDisplayName(entry.key)} options`,
          [
            ...entry.options.map((option) => ({ label: option, value: option })),
            { label: "Custom value", value: "__custom__" },
            { label: "Back", value: "__back__" },
          ],
          {
            subtitle: withPath(
              [...pathItems, "Options"],
              `${buildEntrySubtitle(entry, envMap)}\nChoose a suggested value or enter a custom one.`,
            ),
            escapeValue: "__back__",
          },
        );

        if (optionChoice === "__back__") {
          continue;
        }

        if (optionChoice === "__custom__") {
          const nextValue = await promptForValue("Enter custom value", inputDefaultValue);
          if (!nextValue) continue;
          if (!entry.commented && nextValue === entry.defaultValue) {
            delete envMap[entry.key];
          } else {
            envMap[entry.key] = nextValue;
          }
        } else if (!entry.commented && optionChoice === entry.defaultValue) {
          delete envMap[entry.key];
        } else {
          envMap[entry.key] = optionChoice;
        }
      } else {
        const nextValue = await promptForValue("Enter value", inputDefaultValue);
        if (!nextValue) continue;
        if (!entry.commented && nextValue === entry.defaultValue) {
          delete envMap[entry.key];
        } else {
          envMap[entry.key] = nextValue;
        }
      }
    } else {
      console.log(color.red("Invalid choice."));
      continue;
    }

    persistEnvMap();
    console.log(color.green(`Saved ${entry.key} to ${envPath}`));
  }
}

async function manageSection(
  section: TemplateSection,
  envMap: EnvMap,
  persistEnvMap: () => void,
  pathItems: string[],
): Promise<"back" | "quit"> {
  while (true) {
    const items: Array<MenuItem<string>> = section.entries.map((entry) => {
      const currentValue = getEffectiveValue(entry, envMap);
      const status = isConfigured(entry, envMap) ? "configured" : "template";
      const value = currentValue === undefined ? "(commented / unset)" : maskValue(entry.key, currentValue);
      return {
        label: `${getEntryDisplayName(entry.key)} = ${value}`,
        hint: status,
        value: entry.key,
      };
    });

    items.push({ label: "Back", value: "__back__" });
    items.push({ label: "Quit", value: "__quit__" });

    const choice = await selectWithArrows(
      `${section.title} (${section.entries.length} vars)`,
      items,
      {
        subtitle: withPath(pathItems, "Select a variable to edit."),
        escapeValue: "__back__",
      },
    );

    if (choice === "__quit__") return "quit";
    if (choice === "__back__") return "back";

    const entry = section.entries.find((item) => item.key === choice);
    if (!entry) {
      console.log(color.red("Invalid choice."));
      continue;
    }

    const result = await editEntry(
      entry,
      envMap,
      persistEnvMap,
      [...pathItems, getEntryDisplayName(entry.key)],
    );
    if (result === "quit") return "quit";
  }
}

async function manageExtraKeys(
  envMap: EnvMap,
  knownKeys: Set<string>,
  persistEnvMap: () => void,
  pathItems: string[],
): Promise<"back" | "quit"> {
  while (true) {
    const extraKeys = Object.keys(envMap).filter((key) => !knownKeys.has(key));
    if (extraKeys.length === 0) {
      console.log(color.yellow("No extra keys outside .env.template."));
      return "back";
    }

    const choice = await selectWithArrows(
      "Extra .env keys",
      [
        ...extraKeys.map((key) => ({
          label: `${key} = ${maskValue(key, envMap[key])}`,
          value: key,
        })),
        { label: "Back", value: "__back__" },
        { label: "Quit", value: "__quit__" },
      ],
      {
        subtitle: withPath(pathItems, "Manage keys that are not defined in .env.template."),
        escapeValue: "__back__",
      },
    );

    if (choice === "__quit__") return "quit";
    if (choice === "__back__") return "back";

    const key = extraKeys.find((item) => item === choice);
    if (!key) {
      console.log(color.red("Invalid choice."));
      continue;
    }

    console.log("");
    console.log(color.bold(key));
    console.log(`Current: ${maskValue(key, envMap[key])}`);

    const action = await selectWithArrows(
      "Choose an action",
      [
        { label: "Edit value", value: "edit" },
        { label: "Delete key", value: "delete" },
        { label: "Back", value: "back" },
        { label: "Quit", value: "quit" },
      ],
      {
        subtitle: withPath([...pathItems, key], `Current: ${maskValue(key, envMap[key])}`),
        escapeValue: "back",
      },
    );

    if (action === "quit") return "quit";
    if (action === "back") continue;

    if (action === "edit") {
      const nextValue = await promptForValue("Enter value: ");
      if (!nextValue) continue;
      envMap[key] = nextValue;
      persistEnvMap();
      console.log(color.green(`Saved ${key} to ${envPath}`));
    } else if (action === "delete") {
      delete envMap[key];
      persistEnvMap();
      console.log(color.green(`Deleted ${key} from ${envPath}`));
    } else {
      console.log(color.red("Invalid choice."));
    }
  }
}

async function manageGroup(
  groupTitle: string,
  sections: TemplateSection[],
  envMap: EnvMap,
  persistEnvMap: () => void,
  pathItems: string[],
): Promise<"back" | "quit"> {
  while (true) {
    const nodes = buildSectionMenuNodes(groupTitle, sections, envMap);
    const items: Array<MenuItem<string>> = nodes.map((node) => ({
      label: node.title,
      hint: node.hint,
      value: node.title,
    }));

    items.push({ label: "Back", value: "__back__" });
    items.push({ label: "Quit", value: "__quit__" });

    const choice = await selectWithArrows(
      groupTitle,
      items,
      {
        subtitle: withPath(pathItems, "Select a section to configure."),
        escapeValue: "__back__",
      },
    );

    if (choice === "__quit__") return "quit";
    if (choice === "__back__") return "back";

    const node = nodes.find((item) => item.title === choice);
    if (!node) {
      console.log(color.red("Invalid choice."));
      continue;
    }

    const result =
      node.kind === "folder" && node.sections
        ? await manageGroup(
            node.title,
            node.sections,
            envMap,
            persistEnvMap,
            [...pathItems, node.title],
          )
        : node.section
          ? await manageSection(
              node.section,
              envMap,
              persistEnvMap,
              [...pathItems, node.section.title],
            )
          : "back";
    if (result === "quit") return "quit";
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(envTemplatePath)) {
    throw new Error(`.env.template not found at ${envTemplatePath}`);
  }

  if (!fs.existsSync(envPath)) {
    fs.copyFileSync(envTemplatePath, envPath);
    console.log(color.green(`Created ${envPath} from .env.template`));
  }

  const sections = parseTemplate();
  const groupedSections = buildGroupedSections(sections);
  const knownKeys = new Set(sections.flatMap((section) => section.entries.map((entry) => entry.key)));
  const envMap = normalizeEnvMap(loadEnvMap(), sections);
  let backupPath: string | null = null;

  const persistEnvMap = (): void => {
    if (!backupPath) {
      backupPath = ensureBackup();
      if (backupPath) {
        console.log(color.dim(`Backup created: ${backupPath}`));
      }
    }
    saveEnvMap(envMap);
  };

  console.log(color.bold("Whisplay Configure"));
  console.log(color.dim(`Managing ${envPath}`));

  while (true) {
    const groupChoice = await selectWithArrows(
      "Choose a category",
      [
        ...groupedSections.map(({ group, sections: groupSections }) => {
          const configuredCount = groupSections.reduce(
            (sum, section) => sum + section.entries.filter((entry) => isConfigured(entry, envMap)).length,
            0,
          );
          const totalCount = groupSections.reduce((sum, section) => sum + section.entries.length, 0);
          return {
            label: group.title,
            hint: `${configuredCount}/${totalCount} configured`,
            value: group.key,
          };
        }),
        {
          label: "Extra keys",
          hint: `${Object.keys(envMap).filter((key) => !knownKeys.has(key)).length} items`,
          value: "__extra__",
        },
        { label: "Quit", value: "__quit__" },
      ],
      {
        subtitle: withPath(["Home"], "Top-level groups are condensed from the full .env template."),
        escapeValue: "__quit__",
      },
    );

    if (groupChoice === "__quit__") break;
    if (groupChoice === "__extra__") {
      const result = await manageExtraKeys(envMap, knownKeys, persistEnvMap, [
        "Home",
        "Extra keys",
      ]);
      if (result === "quit") break;
      continue;
    }

    const selectedGroup = groupedSections.find(({ group }) => group.key === groupChoice);
    if (!selectedGroup) {
      console.log(color.red("Invalid choice."));
      continue;
    }

    const result =
      selectedGroup.sections.length === 1 &&
      selectedGroup.sections[0].title === selectedGroup.group.title
        ? await manageSection(selectedGroup.sections[0], envMap, persistEnvMap, [
            "Home",
            selectedGroup.group.title,
          ])
        : await manageGroup(
            selectedGroup.group.title,
            selectedGroup.sections,
            envMap,
            persistEnvMap,
            ["Home", selectedGroup.group.title],
          );
    if (result === "quit") break;
  }

  console.log(color.green("Configure finished."));
}

main()
  .catch((error) => {
    console.error(
      color.red(`Configure failed: ${error instanceof Error ? error.message : String(error)}`),
    );
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
  });
