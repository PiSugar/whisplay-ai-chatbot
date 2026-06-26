import { ChildProcess, spawn } from "child_process";
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

type CommandJobStatus = "queued" | "running" | "completed";

type CommandJob = {
  id: string;
  command: string;
  status: CommandJobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  output: string;
  child?: ChildProcess;
  stopRequested?: boolean;
  nextCheckAt?: number;
  result?: CommandResult;
  completion: Promise<CommandResult>;
  resolve: (result: CommandResult) => void;
};

type SkillInfo = {
  name: string;
  description: string;
  filePath: string;
};

const DEFAULT_FOREGROUND_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_COMMAND_CHARS = 3_000;
const DEFAULT_SPILL_CHARS = 4_000;
const DEFAULT_RETURN_CHARS = 1_200;
const DEFAULT_TEMP_DIR = "/tmp/whisplay-hardness";
const DEFAULT_SKILL_RETURN_CHARS = 8_000;
const DEFAULT_MAX_CONCURRENT_COMMANDS = 2;
const DEFAULT_COMMAND_CHECK_AFTER_SECONDS = 15;
const MAX_SKILL_SCAN_DEPTH = 3;
const SUPPRESSED_OUTPUT_LINES = new Set([
  "SSH is enabled and the default password for the 'pi' user has not been changed.",
  "This is a security risk - please login as the 'pi' user and type 'passwd' to set a new password.",
]);
const commandQueue: CommandJob[] = [];
const commandJobs = new Map<string, CommandJob>();
let activeCommandCount = 0;
let commandJobSeq = 0;
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

const sanitizeCommandOutput = (output: string): string =>
  output
    .split(/\r?\n/)
    .filter((line) => !SUPPRESSED_OUTPUT_LINES.has(line.trim()))
    .join("\n")
    .replace(/^\n+/, "");

const getCommandHead = (segment: string): string => {
  const match = segment.trim().match(/^([A-Za-z0-9_./-]+)/);
  return match ? path.basename(match[1]) : "";
};

const validateCommand = (command: string): string | null => {
  if (parseBoolEnv("HARDNESS_COMMAND_ALLOW_DANGEROUS")) return null;
  const trimmed = command.trim();
  const maxCommandChars = parseIntEnv(
    "HARDNESS_COMMAND_MAX_CHARS",
    DEFAULT_MAX_COMMAND_CHARS,
  );
  if (!trimmed) return "Command is empty.";
  if (trimmed.length > maxCommandChars) {
    return `Command is too long. Maximum length is ${maxCommandChars} characters.`;
  }
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

const getForegroundTimeoutMs = (): number =>
  parseIntEnv("HARDNESS_COMMAND_FOREGROUND_TIMEOUT_MS", DEFAULT_FOREGROUND_TIMEOUT_MS);

const getMaxConcurrentCommands = (): number =>
  parseIntEnv("HARDNESS_COMMAND_MAX_CONCURRENT", DEFAULT_MAX_CONCURRENT_COMMANDS);

const getCheckAfterSeconds = (): number =>
  parseIntEnv(
    "HARDNESS_COMMAND_CHECK_AFTER_SECONDS",
    DEFAULT_COMMAND_CHECK_AFTER_SECONDS,
  );

const createCommandJob = (command: string): CommandJob => {
  let resolveJob!: (result: CommandResult) => void;
  const completion = new Promise<CommandResult>((resolve) => {
    resolveJob = resolve;
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const job: CommandJob = {
    id: `cmd-${stamp}-${process.pid}-${++commandJobSeq}`,
    command,
    status: "queued",
    createdAt: Date.now(),
    output: "",
    completion,
    resolve: resolveJob,
  };
  commandJobs.set(job.id, job);
  return job;
};

const finishCommandJob = (job: CommandJob, result: CommandResult): void => {
  job.status = "completed";
  job.finishedAt = Date.now();
  job.child = undefined;
  job.result = result;
  job.output = result.output;
  job.resolve(result);
};

const terminateCommandJob = (job: CommandJob, signal: NodeJS.Signals = "SIGTERM"): boolean => {
  job.stopRequested = true;
  if (job.status === "queued") {
    const index = commandQueue.findIndex((candidate) => candidate.id === job.id);
    if (index >= 0) commandQueue.splice(index, 1);
    finishCommandJob(job, {
      exitCode: null,
      durationMs: Date.now() - job.createdAt,
      timedOut: false,
      output: "Command was stopped before it started.",
      truncated: false,
    });
    return true;
  }

  if (!job.child?.pid || job.status !== "running") return false;
  try {
    process.kill(-job.child.pid, signal);
  } catch {
    try {
      process.kill(job.child.pid, signal);
    } catch {
      return false;
    }
  }
  return true;
};

const cleanupCommandPool = (): void => {
  for (const job of commandJobs.values()) {
    if (job.status === "running" || job.status === "queued") {
      terminateCommandJob(job, "SIGTERM");
    }
  }
  commandQueue.length = 0;
  commandJobs.clear();
  activeCommandCount = 0;
};

process.once("exit", cleanupCommandPool);

const startQueuedCommands = (): void => {
  const maxConcurrent = getMaxConcurrentCommands();
  while (activeCommandCount < maxConcurrent && commandQueue.length > 0) {
    const job = commandQueue.shift()!;
    startCommandJob(job);
  }
};

const enqueueCommandJob = (job: CommandJob): void => {
  commandQueue.push(job);
  startQueuedCommands();
};

const startCommandJob = (job: CommandJob): void => {
  const spillChars = parseIntEnv("HARDNESS_COMMAND_SPILL_CHARS", DEFAULT_SPILL_CHARS);
  const tempDir = process.env.HARDNESS_COMMAND_TEMP_DIR || DEFAULT_TEMP_DIR;
  const startedAt = Date.now();
  let output = "";
  let completed = false;

  job.status = "running";
  job.startedAt = startedAt;
  activeCommandCount += 1;

  const child = spawn("bash", ["-lc", job.command], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.child = child;

  const append = (chunk: Buffer): void => {
    output += chunk.toString("utf8");
    job.output = output;
  };

  child.stdout.on("data", append);
  child.stderr.on("data", append);

  const complete = (exitCode: number | null, extraOutput = ""): void => {
    if (completed) return;
    completed = true;
    if (extraOutput) output += extraOutput;
    output = sanitizeCommandOutput(output);
    job.output = output;
    activeCommandCount = Math.max(0, activeCommandCount - 1);
    const durationMs = Date.now() - startedAt;
    const spill = spillOutputIfNeeded(job.command, output, spillChars, tempDir);
    finishCommandJob(job, {
      exitCode,
      durationMs,
      timedOut: false,
      output,
      ...spill,
    });
    startQueuedCommands();
  };

  child.on("error", (error) => {
    complete(null, `\n${error.message}`);
  });

  child.on("close", (code) => {
    complete(code);
  });
};

const waitForCommandForeground = async (job: CommandJob): Promise<CommandResult | null> => {
  const foregroundTimeoutMs = getForegroundTimeoutMs();
  return await new Promise<CommandResult | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), foregroundTimeoutMs);
    job.completion.then((result) => {
      clearTimeout(timeout);
      resolve(result);
    });
  });
};

const formatResult = (result: CommandResult): string => {
  const returnChars = parseIntEnv("HARDNESS_COMMAND_RETURN_CHARS", DEFAULT_RETURN_CHARS);
  const tag =
    result.exitCode === 0 && !result.timedOut ? ToolReturnTag.Success : ToolReturnTag.Error;
  const tail = tailText(sanitizeCommandOutput(result.output).trim(), returnChars);
  return [
    `${tag} exit_code=${result.exitCode ?? "null"} duration_ms=${result.durationMs} timed_out=${result.timedOut} truncated=${result.truncated}${result.outputFile ? ` output_file=${result.outputFile}` : ""}`,
    "tail:",
    tail || "(no output)",
  ].join("\n");
};

const formatJobResult = (job: CommandJob): string => {
  if (!job.result) return formatBackgroundStatus(job);
  return [
    `${ToolReturnTag.Success} status=completed job_id=${job.id}`,
    formatResult(job.result),
  ].join("\n");
};

const formatBackgroundStatus = (job: CommandJob): string => {
  if (job.result) return formatJobResult(job);

  const returnChars = parseIntEnv("HARDNESS_COMMAND_RETURN_CHARS", DEFAULT_RETURN_CHARS);
  const now = Date.now();
  const elapsedMs = job.startedAt ? now - job.startedAt : 0;
  const queuedMs = job.startedAt ? job.startedAt - job.createdAt : now - job.createdAt;
  const checkAfterSeconds = getCheckAfterSeconds();
  job.nextCheckAt = now + checkAfterSeconds * 1000;
  const tail = tailText(sanitizeCommandOutput(job.output).trim(), returnChars);
  return [
    `${ToolReturnTag.Success} status=${job.status} job_id=${job.id} elapsed_ms=${elapsedMs} queued_ms=${queuedMs} stop_requested=${job.stopRequested === true} check_after_seconds=${checkAfterSeconds}`,
    "message:",
    `Command is ${job.status === "queued" ? "waiting in the command pool" : "still running in the background"}. Continue reasoning and call checkCommand with this job_id after the suggested delay.`,
    "tail:",
    tail || "(no output yet)",
  ].join("\n");
};

const waitForCheckWindow = async (job: CommandJob): Promise<void> => {
  if (job.result || !job.nextCheckAt) return;

  const waitMs = job.nextCheckAt - Date.now();
  if (waitMs <= 0) return;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, waitMs);
    job.completion.then(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
};

const runShellCommand = async (command: string): Promise<string> => {
  const job = createCommandJob(command);
  enqueueCommandJob(job);
  const result = await waitForCommandForeground(job);
  return result ? formatResult(result) : formatBackgroundStatus(job);
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
            "One allowlisted shell command, up to 3000 characters, such as pwd, ls -la /home/pi, date, hostname -I, ip neigh show, curl -s URL, mkdir -p /home/pi/example, or printf text > /home/pi/example/file.txt.",
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

    return await runShellCommand(command);
  },
};

const checkCommandTool: LLMTool = {
  type: "function",
  function: {
    name: "checkCommand",
    description:
      "Check the progress or final result of a background command returned by runCommand. If called before the job's check_after_seconds has elapsed, this tool waits until the check window instead of returning early. This status check never enters the command execution pool.",
    parameters: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description:
            "The job_id returned by runCommand, such as cmd-2026-01-01T00-00-00-000Z-1234-1.",
        },
      },
      required: ["job_id"],
    },
  },
  func: async (params: any): Promise<string> => {
    const jobId = `${params?.job_id ?? params?.jobId ?? ""}`.trim();
    const job = commandJobs.get(jobId);
    if (!job) {
      return `${ToolReturnTag.Error} Command job not found: ${jobId || "(empty)"}`;
    }

    await waitForCheckWindow(job);

    return formatBackgroundStatus(job);
  },
};

const stopCommandTool: LLMTool = {
  type: "function",
  function: {
    name: "stopCommand",
    description:
      "Stop a queued or running background command when you decide it is no longer needed, stuck, or unsafe to keep running. Prefer SIGTERM first; use SIGKILL only if SIGTERM does not stop it.",
    parameters: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "The job_id returned by runCommand.",
        },
        signal: {
          type: "string",
          description: "Signal to send to the process group. Use SIGTERM by default; SIGKILL is the force option.",
          enum: ["SIGTERM", "SIGKILL"],
        },
      },
      required: ["job_id"],
    },
  },
  func: async (params: any): Promise<string> => {
    const jobId = `${params?.job_id ?? params?.jobId ?? ""}`.trim();
    const requestedSignal = `${params?.signal ?? "SIGTERM"}`.trim();
    const signal: NodeJS.Signals = requestedSignal === "SIGKILL" ? "SIGKILL" : "SIGTERM";
    const job = commandJobs.get(jobId);
    if (!job) {
      return `${ToolReturnTag.Error} Command job not found: ${jobId || "(empty)"}`;
    }
    if (job.status === "completed") {
      return `${ToolReturnTag.Success} status=completed job_id=${job.id}\nmessage:\nCommand already completed.`;
    }

    const stopped = terminateCommandJob(job, signal);
    return [
      stopped ? ToolReturnTag.Success : ToolReturnTag.Error,
      `status=${job.status} job_id=${job.id} signal=${signal} stop_requested=${job.stopRequested === true}`,
      "message:",
      stopped
        ? "Stop signal sent. Call checkCommand to confirm the final process result."
        : "Unable to signal this command process.",
    ].join("\n");
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
  tools.push(runCommandTool, checkCommandTool, stopCommandTool);
  console.log("[HardnessCommand] Added runCommand, checkCommand and stopCommand tools.");

  if (parseBoolEnv("HARDNESS_SKILL_TOOL_ENABLED", true)) {
    tools.push(listSkillsTool, readSkillTool);
    console.log("[HardnessCommand] Added skill tools.");
  }
};
