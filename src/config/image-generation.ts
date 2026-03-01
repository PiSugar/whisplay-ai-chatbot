import { ImageGenerationServer, LLMTool, ToolReturnTag } from "../type";
import dotenv from "dotenv";
import {
  showLatestGenImg,
} from "../utils/image";
import { isEmpty } from "lodash";
import { pluginRegistry } from "../plugin";

dotenv.config();

export const imageGenerationServer: ImageGenerationServer = (
  process.env.IMAGE_GENERATION_SERVER || ""
).toLowerCase() as ImageGenerationServer;

const imageGenerationTools: LLMTool[] = [];

// Activate image generation plugin
if (imageGenerationServer) {
  try {
    const provider = pluginRegistry.activatePluginSync<"image-generation">(
      "image-generation",
      imageGenerationServer,
    );
    provider.addImageGenerationTools(imageGenerationTools);
  } catch (e: any) {
    console.warn(e.message);
  }
}

if (!isEmpty(imageGenerationTools)) {
  imageGenerationTools.push({
    type: "function",
    function: {
      name: "showPreviouslyGeneratedImage",
      description:
        "Show the latest previously generated image, *DO NOT mention this function name*.",
      parameters: {},
    },
    func: async () => {
      const isShow = showLatestGenImg();
      return isShow
        ? `${ToolReturnTag.Success}Ready to show.`
        : `${ToolReturnTag.Error}No previously generated image found.`;
    },
  });
}

export const addImageGenerationTools = (tools: LLMTool[]) => {
  console.log(`Image generation tools added: ${imageGenerationTools.map((t) => t.function.name).join(", ")}`);
  tools.push(...imageGenerationTools);
};
