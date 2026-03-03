import { LLMTool } from "../type";
import { cloneDeep } from "lodash";
import { transformToGeminiType } from "../utils";
import { addImageGenerationTools } from "./image-generation";
import { addVisionTools } from "./vision";
import { pluginRegistry } from "../plugin";

// ── Collect tools from all llm-tools plugins ────────────────
const pluginTools: LLMTool[] = [];

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

// ── Add image-generation & vision tools ─────────────────────
addImageGenerationTools(pluginTools);
addVisionTools(pluginTools);

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
