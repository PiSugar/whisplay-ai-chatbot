import { pluginRegistry } from "../registry";
import { VisionPlugin } from "../types";
import { LLMTool } from "../../type";

export function registerVisionPlugins(): void {
  pluginRegistry.register({
    name: "ollama",
    displayName: "Ollama Vision",
    version: "1.0.0",
    type: "vision",
    description: "Ollama local vision model",
    activate: () => {
      const { addOllamaVisionTool } = require("../../cloud-api/local/ollama-vision");
      return {
        addVisionTools: (tools: LLMTool[]) => addOllamaVisionTool(tools),
      };
    },
  } as VisionPlugin);

  pluginRegistry.register({
    name: "openai",
    displayName: "OpenAI Vision",
    version: "1.0.0",
    type: "vision",
    description: "OpenAI vision model",
    activate: () => {
      const { addOpenaiVisionTool } = require("../../cloud-api/openai/openai-vision");
      return {
        addVisionTools: (tools: LLMTool[]) => addOpenaiVisionTool(tools),
      };
    },
  } as VisionPlugin);

  pluginRegistry.register({
    name: "gemini",
    displayName: "Gemini Vision",
    version: "1.0.0",
    type: "vision",
    description: "Google Gemini vision model",
    activate: () => {
      const { addGeminiVisionTool } = require("../../cloud-api/gemini/gemini-vision");
      return {
        addVisionTools: (tools: LLMTool[]) => addGeminiVisionTool(tools),
      };
    },
  } as VisionPlugin);

  pluginRegistry.register({
    name: "volcengine",
    displayName: "Volcengine Vision",
    version: "1.0.0",
    type: "vision",
    description: "Volcengine vision model",
    activate: () => {
      const { addVolcengineVisionTool } = require("../../cloud-api/volcengine/volcengine-vision");
      return {
        addVisionTools: (tools: LLMTool[]) => addVolcengineVisionTool(tools),
      };
    },
  } as VisionPlugin);
}
