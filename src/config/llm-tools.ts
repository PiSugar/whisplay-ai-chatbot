import { LLMTool, ToolReturnTag } from "../type";
import { cloneDeep } from "lodash";
import { transformToGeminiType } from "../utils";
import { addImageGenerationTools } from "./image-generation";
import { addVisionTools } from "./vision";
import { addWebSearchTools } from "./web-search";
import { pluginRegistry } from "../plugin";

// ── Collect tools from all llm-tools plugins ────────────────
const pluginTools: LLMTool[] = [];

const wakeWordEnabled =
  (process.env.WAKE_WORD_ENABLED || "").toLowerCase() === "true";

if (wakeWordEnabled) {
  pluginTools.push({
    type: "function",
    function: {
      name: "endConversation",
      description:
        "Mark the current wakeword conversation to end after your next reply. Call this when the user clearly wants to stop, end, or wrap up the conversation. Do not mention the function name.",
      parameters: {},
    },
    func: async () => {
      return `${ToolReturnTag.Success}This conversation will end after your reply.`;
    },
  });
}

const activated = pluginRegistry.activateAllPluginsSync("llm-tools");
for (const { name, provider } of activated) {
  try {
    const tools = provider.getTools();
    pluginTools.push(...tools);
    console.log(
      `[LLM-Tools] Loaded ${tools.length} tool(s) from llm-tools plugin: ${name}`,
    );
  } catch (e: any) {
    console.error(`[LLM-Tools] Failed to get tools from ${name}:`, e.message);
  }
}

// ── Add image-generation, vision & web search tools ──────────
addImageGenerationTools(pluginTools);
addVisionTools(pluginTools);
addWebSearchTools(pluginTools);

// ── Exported aggregated tool lists ──────────────────────────
export const llmTools: LLMTool[] = [...pluginTools];

export const llmToolsForGemini: LLMTool[] = pluginTools.map((tool) => {
  const newTool = cloneDeep(tool);
  if (newTool.function && newTool.function.parameters) {
    newTool.function.parameters = transformToGeminiType(
      newTool.function.parameters,
    );
  }
  return newTool;
});

export const llmFuncMap = llmTools.reduce(
  (acc, tool) => {
    acc[tool.function.name] = tool.func;
    return acc;
  },
  {} as Record<string, (params: any) => Promise<string>>,
);
