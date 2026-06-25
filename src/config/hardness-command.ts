import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";
import { LLMTool, ToolReturnTag } from "../type";

dotenv.config();

type CommandResult = {
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  output: string;
  outputFile?: string;
  truncated: boolean;
};

type SkillInfo = {
  name: string;
  description: string;
  filePath: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SPILL_CHARS = 4_000;
const DEFAULT_RETURN_CHARS = 1_200;
const DEFAULT_TEMP_DIR = "/tmp/whisplay-hardness";
const DEFAULT_SKILL_RETURN_CHARS = 8_000;
const MAX_SKILL_SCAN_DEPTH = 3;
const SAFE_COMMANDS = new Set([
  "pwd",
  "ls",
  "cat",
  "head",
  "tail",
  "find",
  "grep",
  "rg",
  "date",
  "hostname",
  "ip",
  "ping",
  "curl",
  "mkdir",
  "printf",
  "echo",
  "wc",
  "du",
  "df",
  "ps",
  "whoami",
  "uname",
  "sed",
  "awk",
  "sort",
  "uniq",
  "cut",
]);

const DANGEROUS_PATTERNS: RegExp[] = [
  /(^|[\s|])sudo([\s]|$)/,
  /(^|[\s|])su([\s]|$)/,
  /(^|[\s|])rm([\s]|$)/,
  /(^|[\s|])dd([\s]|$)/,
  /(^|[\s|])mkfs(\.|[\s]|$)/,
  /(^|[\s|])reboot([\s]|$)/,
  /(^|[\s|])shutdown([\s]|$)/,
  /(^|[\s|])halt([\s]|$)/,
  /(^|[\s|])poweroff([\s]|$)/,
  /(^|[\s|])init\s+[016]/,
  /(^|[\s|])systemctl\s+(stop|disable|mask|restart|reboot|poweroff)\b/,
  /(^|[\s|])service\s+\S+\s+(stop|restart)\b/,
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/,
  /(^|[^\\])`/,
  /\$\(/,
  /(^|[^\\])\n/,
  /(^|[^\\])\r/,
  /(^|[^\\])&($|\s)/,
];

const PROTECTED_WRITE_PATHS = [
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/opt",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
];

const parseBoolEnv = (key: string, defaultValue = false): boolean => {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  return raw.toLowerCase() === "true" || raw === "1";
};

const parseIntEnv = (key: string, defaultValue: number): number => {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
};

const tailText = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
};

const truncateText = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated: ${text.length - maxChars} chars omitted]`;
};

const getCommandHead = (segment: string): string => {
  const match = segment.trim().match(/^([A-Za-z0-9_./-]+)/);
  return match ? path.basename(match[1]) : "";
};

const validateCommand = (command: string): string | null => {
  if (parseBoolEnv("HARDNESS_COMMAND_ALLOW_DANGEROUS")) return null;
  const trimmed = command.trim();
  if (!trimmed) return "Command is empty.";
  if (trimmed.length > 1000) return "Command is too long.";
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return `Command rejected by safety policy: ${pattern.source}`;
    }
  }

  const segments = trimmed
    .split("|")
    .map((segment) => segment.replace(/2?>+.*$/g, "").trim())
    .filter(Boolean);
  if (segments.length === 0) return "Command has no executable segment.";
  for (const segment of segments) {
    const head = getCommandHead(segment);
    if (!SAFE_COMMANDS.has(head)) {
      return `Command '${head || segment}' is not allowlisted.`;
    }
  }

  const redirectMatches = [...trimmed.matchAll(/(?:^|\s)(?:\d?>|>>)\s*("[^"]+"|'[^']+'|\S+)/g)];
  for (const match of redirectMatches) {
    const rawPath = match[1].replace(/^['"]|['"]$/g, "");
    if (!rawPath || rawPath.startsWith("&")) continue;
    if (!isWritableUserPath(rawPath)) {
      return `Refusing to write outside user/temp directories: ${rawPath}`;
    }
  }

  const writePathMatches = [
    ...trimmed.matchAll(/(?:^|\s)mkdir\s+(?:-[A-Za-z]+\s+)*("[^"]+"|'[^']+'|\/\S+)/g),
    ...trimmed.matchAll(/(?:^|\s)curl\s+.*?(?:-o|--output)\s+("[^"]+"|'[^']+'|\S+)/g),
  ];
  for (const match of writePathMatches) {
    const rawPath = match[1].replace(/^['"]|['"]$/g, "");
    if (rawPath.startsWith("-")) continue;
    if (!isWritableUserPath(rawPath)) {
      return `Refusing to write outside user/temp directories: ${rawPath}`;
    }
  }

  return null;
};

const isWritableUserPath = (rawPath: string): boolean => {
  const resolved = path.resolve(rawPath);
  const allowedWrite =
    resolved.startsWith("/tmp/") ||
    resolved === "/tmp" ||
    resolved.startsWith(`${os.homedir()}/`) ||
    resolved.startsWith("/home/pi/");
  const protectedWrite = PROTECTED_WRITE_PATHS.some(
    (protectedPath) => resolved === protectedPath || resolved.startsWith(`${protectedPath}/`),
  );
  return allowedWrite && !protectedWrite;
};

const spillOutputIfNeeded = (
  command: string,
  output: string,
  spillChars: number,
  tempDir: string,
): { outputFile?: string; truncated: boolean } => {
  if (output.length <= spillChars) {
    return { truncated: false };
  }
  fs.mkdirSync(tempDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(tempDir, `command-${stamp}-${process.pid}.log`);
  fs.writeFileSync(filePath, `$ ${command}\n\n${output}`, "utf8");
  return { outputFile: filePath, truncated: true };
};

const runShellCommand = async (command: string): Promise<CommandResult> => {
  const timeoutMs = parseIntEnv("HARDNESS_COMMAND_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const spillChars = parseIntEnv("HARDNESS_COMMAND_SPILL_CHARS", DEFAULT_SPILL_CHARS);
  const tempDir = process.env.HARDNESS_COMMAND_TEMP_DIR || DEFAULT_TEMP_DIR;
  const startedAt = Date.now();
  let output = "";
  let timedOut = false;

  return await new Promise<CommandResult>((resolve) => {
    const child = spawn("bash", ["-lc", command], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const append = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {}
      setTimeout(() => {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {}
      }, 1000);
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      output += `\n${error.message}`;
      const durationMs = Date.now() - startedAt;
      const spill = spillOutputIfNeeded(command, output, spillChars, tempDir);
      resolve({
        exitCode: null,
        durationMs,
        timedOut,
        output,
        ...spill,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startedAt;
      const spill = spillOutputIfNeeded(command, output, spillChars, tempDir);
      resolve({
        exitCode: code,
        durationMs,
        timedOut,
        output,
        ...spill,
      });
    });
  });
};

const formatResult = (result: CommandResult): string => {
  const returnChars = parseIntEnv("HARDNESS_COMMAND_RETURN_CHARS", DEFAULT_RETURN_CHARS);
  const tag =
    result.exitCode === 0 && !result.timedOut ? ToolReturnTag.Success : ToolReturnTag.Error;
  const tail = tailText(result.output.trim(), returnChars);
  return [
    `${tag} exit_code=${result.exitCode ?? "null"} duration_ms=${result.durationMs} timed_out=${result.timedOut} truncated=${result.truncated}${result.outputFile ? ` output_file=${result.outputFile}` : ""}`,
    "tail:",
    tail || "(no output)",
  ].join("\n");
};

const parseSkillRoots = (): string[] => {
  const configured = process.env.HARDNESS_SKILL_DIRS;
  const roots = configured
    ? configured
        .split(/[,:]/)
        .map((value) => value.trim())
        .filter(Boolean)
    : [path.join(process.cwd(), "skills")];

  const seen = new Set<string>();
  return roots
    .map((root) =>
      root.startsWith("~/") ? path.join(os.homedir(), root.slice(2)) : root,
    )
    .map((root) => path.resolve(root))
    .filter((root) => {
      if (seen.has(root)) return false;
      seen.add(root);
      return true;
    });
};

const findSkillFiles = (root: string, depth = 0): string[] => {
  if (depth > MAX_SKILL_SCAN_DEPTH) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const directSkill = path.join(root, "SKILL.md");
  if (fs.existsSync(directSkill)) return [directSkill];

  return entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => findSkillFiles(path.join(root, entry.name), depth + 1));
};

const getFrontmatterValue = (frontmatter: string, key: string): string => {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match ? match[1].trim().replace(/^['"]|['"]$/g, "") : "";
};

const summarizeMarkdown = (content: string): string => {
  const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  const lines = withoutFrontmatter
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("```"));
  return lines[0]?.replace(/^[-*]\s+/, "").slice(0, 280) || "";
};

const readSkillInfo = (filePath: string): SkillInfo | null => {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter = frontmatterMatch?.[1] || "";
  const name =
    getFrontmatterValue(frontmatter, "name") || path.basename(path.dirname(filePath));
  const description =
    getFrontmatterValue(frontmatter, "description") || summarizeMarkdown(content);

  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return null;
  return { name, description, filePath };
};

const getSkillRegistry = (): SkillInfo[] => {
  const byName = new Map<string, SkillInfo>();
  for (const root of parseSkillRoots()) {
    for (const filePath of findSkillFiles(root)) {
      const info = readSkillInfo(filePath);
      if (info && !byName.has(info.name)) {
        byName.set(info.name, info);
      }
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
};

const formatSkillList = (skills: SkillInfo[]): string => {
  if (skills.length === 0) {
    return `${ToolReturnTag.Success} No skills found. Add skills under ./skills or configure HARDNESS_SKILL_DIRS.`;
  }

  const rows = skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
  }));
  return `${ToolReturnTag.Success} ${JSON.stringify(rows, null, 2)}`;
};

const runCommandTool: LLMTool = {
  type: "function",
  function: {
    name: "runCommand",
    description:
      "Run one short, allowlisted command-line command on this device. Use it to get facts; do not guess command output. Break complex tasks into multiple simple commands. Long output is saved to a temporary file and only the last lines are returned.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "A short shell command such as pwd, ls -la /home/pi, date, hostname -I, ip neigh show, curl -s URL, mkdir -p /home/pi/example, or printf text > /home/pi/example/file.txt.",
        },
      },
      required: ["command"],
    },
  },
  func: async (params: any): Promise<string> => {
    const command = `${params?.command ?? ""}`.trim();
    const validationError = validateCommand(command);
    if (validationError) {
      return `${ToolReturnTag.Error} exit_code=null duration_ms=0 timed_out=false truncated=false\nreason:\n${validationError}`;
    }

    const result = await runShellCommand(command);
    return formatResult(result);
  },
};

const listSkillsTool: LLMTool = {
  type: "function",
  function: {
    name: "listSkills",
    description:
      "List installed local skills available to guide command-line work on this device. Use this before readSkill when the user asks to use a skill or when a task may match a reusable local workflow.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  func: async (): Promise<string> => {
    return formatSkillList(getSkillRegistry());
  },
};

const readSkillTool: LLMTool = {
  type: "function",
  function: {
    name: "readSkill",
    description:
      "Read the SKILL.md instructions for one installed local skill. Follow the skill's safety and workflow guidance, then use runCommand for any needed shell checks or actions.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Exact skill name from listSkills, such as sync-agentneo-clash-to-synology.",
        },
      },
      required: ["name"],
    },
  },
  func: async (params: any): Promise<string> => {
    const name = `${params?.name ?? ""}`.trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      return `${ToolReturnTag.Error} Invalid skill name. Use listSkills and pass the exact name.`;
    }

    const skill = getSkillRegistry().find((candidate) => candidate.name === name);
    if (!skill) {
      return `${ToolReturnTag.Error} Skill not found: ${name}. Use listSkills to see available skills.`;
    }

    const maxChars = parseIntEnv("HARDNESS_SKILL_RETURN_CHARS", DEFAULT_SKILL_RETURN_CHARS);
    const content = fs.readFileSync(skill.filePath, "utf8");
    return [
      `${ToolReturnTag.Success} name=${skill.name} path=${skill.filePath}`,
      truncateText(content, maxChars),
    ].join("\n\n");
  },
};

export const addHardnessCommandTools = (tools: LLMTool[]): void => {
  if (!parseBoolEnv("HARDNESS_COMMAND_TOOL_ENABLED")) {
    console.log("[HardnessCommand] Command tool disabled.");
    return;
  }
  tools.push(runCommandTool);
  console.log("[HardnessCommand] Added runCommand tool.");

  if (parseBoolEnv("HARDNESS_SKILL_TOOL_ENABLED", true)) {
    tools.push(listSkillsTool, readSkillTool);
    console.log("[HardnessCommand] Added skill tools.");
  }
};
