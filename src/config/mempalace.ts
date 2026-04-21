import { LLMTool, ToolReturnTag } from "../type";
import dotenv from "dotenv";
import { execFile, spawn } from "child_process";
import moment from "moment";

dotenv.config();

const mempalaceEnabled = process.env.MEMPALACE_ENABLED === "true";
const mempalacePalacePath = process.env.MEMPALACE_PALACE_PATH || "";
const mempalacePythonPath = process.env.MEMPALACE_PYTHON_PATH || "python3";
const mempalaceMaxResults = parseInt(
  process.env.MEMPALACE_MAX_RESULTS || "5",
  10,
);
const mempalaceDefaultWing = process.env.MEMPALACE_DEFAULT_WING || "";
const mempalaceAutoSave =
  process.env.MEMPALACE_AUTO_SAVE !== "false" && mempalaceEnabled;

export const mempalaceTools: LLMTool[] = [];

/**
 * Run a mempalace CLI command and return stdout.
 */
function runMempalace(args: string[]): Promise<string> {
  const fullArgs = ["-m", "mempalace.cli", ...args];
  if (mempalacePalacePath) {
    fullArgs.push("--palace", mempalacePalacePath);
  }
  return new Promise((resolve, reject) => {
    execFile(
      mempalacePythonPath,
      fullArgs,
      { timeout: 30_000, maxBuffer: 1024 * 512 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

if (mempalaceEnabled) {
  console.log("[MemPalace] Enabled");

  // ── Search memories ───────────────────────────────────────
  mempalaceTools.push({
    type: "function",
    function: {
      name: "mempalaceSearch",
      description:
        "Search the user's long-term memory palace for past conversations, decisions, facts, and preferences. " +
        "Use this when the user asks about something that may have been discussed before, " +
        'or when context from previous sessions would help (e.g. "why did we choose X", ' +
        '"what did I say about Y last time").',
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The semantic search query to look up in memory",
          },
          wing: {
            type: "string",
            description:
              "Optional wing (person or project) to narrow the search scope",
          },
          room: {
            type: "string",
            description: "Optional room (topic) to narrow the search scope",
          },
        },
        required: ["query"],
      },
    },
    func: async (params: { query: string; wing?: string; room?: string }) => {
      try {
        const args = ["search", params.query];
        const wing = params.wing || mempalaceDefaultWing;
        if (wing) {
          args.push("--wing", wing);
        }
        if (params.room) {
          args.push("--room", params.room);
        }
        args.push("--top-k", String(mempalaceMaxResults));
        const result = await runMempalace(args);
        if (!result.trim()) {
          return `${ToolReturnTag.Success}No memories found for this query.`;
        }
        return `${ToolReturnTag.Success}${result.trim()}`;
      } catch (error: any) {
        console.error("[MemPalace] Search error:", error.message);
        return `${ToolReturnTag.Error}Failed to search memories: ${error.message}`;
      }
    },
  });

  // ── Store a memory ────────────────────────────────────────
  mempalaceTools.push({
    type: "function",
    function: {
      name: "mempalaceStore",
      description:
        "Store an important piece of information into the user's long-term memory palace. " +
        "Use this to save key decisions, preferences, facts, or insights that the user " +
        "may want to recall in future conversations.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "The verbatim content to store (decision, preference, fact, etc.)",
          },
          wing: {
            type: "string",
            description:
              "The wing (person or project) to file this memory under",
          },
          room: {
            type: "string",
            description:
              "The room (topic) to file this memory under (e.g. auth-migration, preferences)",
          },
          hall: {
            type: "string",
            description:
              "The hall type: hall_facts, hall_events, hall_discoveries, hall_preferences, or hall_advice",
          },
        },
        required: ["content"],
      },
    },
    func: async (params: {
      content: string;
      wing?: string;
      room?: string;
      hall?: string;
    }) => {
      try {
        const result = await storeToMemPalace(params);
        return `${ToolReturnTag.Success}Memory stored successfully. ${result}`;
      } catch (error: any) {
        console.error("[MemPalace] Store error:", error.message);
        return `${ToolReturnTag.Error}Failed to store memory: ${error.message}`;
      }
    },
  });

  // ── Wake-up context ───────────────────────────────────────
  mempalaceTools.push({
    type: "function",
    function: {
      name: "mempalaceWakeUp",
      description:
        "Load the user's critical context from the memory palace (identity, key facts, preferences). " +
        "Use this at the start of a conversation or when the user asks you to remember who they are " +
        "or what projects they are working on.",
      parameters: {
        type: "object",
        properties: {
          wing: {
            type: "string",
            description:
              "Optional wing to get project-specific wake-up context",
          },
        },
      },
    },
    func: async (params: { wing?: string }) => {
      try {
        const args = ["wake-up"];
        const wing = params.wing || mempalaceDefaultWing;
        if (wing) {
          args.push("--wing", wing);
        }
        const result = await runMempalace(args);
        if (!result.trim()) {
          return `${ToolReturnTag.Success}No wake-up context configured yet. Run "mempalace init" to set up the palace.`;
        }
        return `${ToolReturnTag.Success}${result.trim()}`;
      } catch (error: any) {
        console.error("[MemPalace] Wake-up error:", error.message);
        return `${ToolReturnTag.Error}Failed to load wake-up context: ${error.message}`;
      }
    },
  });

  // ── Palace status ─────────────────────────────────────────
  mempalaceTools.push({
    type: "function",
    function: {
      name: "mempalaceStatus",
      description:
        "Get an overview of the user's memory palace: wings, rooms, memory counts, and storage stats.",
      parameters: {},
    },
    func: async () => {
      try {
        const result = await runMempalace(["status"]);
        return `${ToolReturnTag.Success}${result.trim()}`;
      } catch (error: any) {
        console.error("[MemPalace] Status error:", error.message);
        return `${ToolReturnTag.Error}Failed to get palace status: ${error.message}`;
      }
    },
  });
}

/**
 * Run a Python script via stdin — avoids shell injection from user content.
 */
function runPythonScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(mempalacePythonPath, ["-c", script], {
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `exit code ${code}`));
      else resolve(stdout);
    });
    proc.on("error", reject);
  });
}

/**
 * Store content to MemPalace using the Python API via stdin JSON.
 * Content is passed as a JSON object to avoid any injection issues.
 */
function storeToMemPalace(params: {
  content: string;
  wing?: string;
  room?: string;
  hall?: string;
}): Promise<string> {
  const payload = JSON.stringify({
    content: params.content,
    wing: params.wing || mempalaceDefaultWing || "wing_general",
    room: params.room || "general",
    hall: params.hall || "hall_events",
    palace_path: mempalacePalacePath || null,
  });

  // Python script reads JSON from stdin — no string embedding
  const script = `
import json, sys, os, uuid, time
data = json.loads(sys.stdin.read())
palace = data.get("palace_path") or os.path.expanduser("~/.mempalace/palace")
import chromadb
client = chromadb.PersistentClient(path=palace)
col = client.get_or_create_collection("mempalace_drawers")
doc_id = str(uuid.uuid4())
meta = {"wing": data["wing"], "room": data["room"], "hall": data["hall"], "timestamp": time.time()}
col.add(ids=[doc_id], documents=[data["content"]], metadatas=[meta])
print(f"Stored in {data['wing']}/{data['hall']}/{data['room']} (id={doc_id})")
`.trim();

  return new Promise((resolve, reject) => {
    const proc = spawn(mempalacePythonPath, ["-c", script], {
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `exit code ${code}`));
      else resolve(stdout.trim());
    });
    proc.on("error", reject);
    proc.stdin.write(payload);
    proc.stdin.end();
  });
}

/**
 * Auto-save a completed user↔assistant exchange to MemPalace.
 * Runs in the background — errors are logged but never block the chat flow.
 */
export function autoSaveExchange(
  userText: string,
  assistantText: string,
): void {
  if (!mempalaceAutoSave) return;
  if (!userText.trim() || !assistantText.trim()) return;

  const ts = moment().format("YYYY-MM-DD HH:mm:ss");
  const content = `[${ts}]\nUser: ${userText}\nAssistant: ${assistantText}`;

  storeToMemPalace({
    content,
    wing: mempalaceDefaultWing || "wing_general",
    room: "conversations",
    hall: "hall_events",
  })
    .then((res) => console.log(`[MemPalace] Auto-saved exchange: ${res}`))
    .catch((err) =>
      console.error(`[MemPalace] Auto-save failed: ${err.message}`),
    );
}

export const addMemPalaceTools = (tools: LLMTool[]) => {
  if (mempalaceTools.length > 0) {
    console.log(
      `[MemPalace] Adding ${mempalaceTools.length} tool(s): ` +
        `${mempalaceTools.map((t) => t.function.name).join(", ")}`,
    );
    tools.push(...mempalaceTools);
  }
};
