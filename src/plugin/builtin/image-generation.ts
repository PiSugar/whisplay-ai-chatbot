import { pluginRegistry } from "../registry";
import { ImageGenerationPlugin } from "../types";
import { LLMTool } from "../../type";

export function registerImageGenerationPlugins(): void {
  pluginRegistry.register({
    name: "gemini",
    displayName: "Gemini Image Generation",
    version: "1.0.0",
    type: "image-generation",
    description: "Google Gemini image generation",
    activate: () => {
      const { addGeminiGenerationTool } = require("../../cloud-api/gemini/gemini-image-generation");
      return {
        addImageGenerationTools: (tools: LLMTool[]) =>
          addGeminiGenerationTool(tools),
      };
    },
  } as ImageGenerationPlugin);

  pluginRegistry.register({
    name: "openai",
    displayName: "OpenAI Image Generation",
    version: "1.0.0",
    type: "image-generation",
    description: "OpenAI DALL-E image generation",
    activate: () => {
      const { addOpenaiGenerationTool } = require("../../cloud-api/openai/openai-image-generation");
      return {
        addImageGenerationTools: (tools: LLMTool[]) =>
          addOpenaiGenerationTool(tools),
      };
    },
  } as ImageGenerationPlugin);

  pluginRegistry.register({
    name: "volcengine",
    displayName: "Volcengine Image Generation",
    version: "1.0.0",
    type: "image-generation",
    description: "Volcengine image generation",
    activate: () => {
      const { addVolcengineGenerationTool } = require("../../cloud-api/volcengine/volcengine-image-generation");
      return {
        addImageGenerationTools: (tools: LLMTool[]) =>
          addVolcengineGenerationTool(tools),
      };
    },
  } as ImageGenerationPlugin);

  pluginRegistry.register({
    name: "llm8850lcm",
    displayName: "LLM8850 LCM Image Generation",
    version: "1.0.0",
    type: "image-generation",
    description: "LLM8850 LCM local image generation via HTTP API",
    activate: () => {
      const { addLlm8850lcmGenerationTool } = require("../../cloud-api/local/llm8850lcm-image-generation");
      return {
        addImageGenerationTools: (tools: LLMTool[]) =>
          addLlm8850lcmGenerationTool(tools),
      };
    },
  } as ImageGenerationPlugin);
}
