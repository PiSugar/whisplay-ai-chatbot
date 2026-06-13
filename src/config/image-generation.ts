import { ImageGenerationServer, LLMTool, ToolReturnTag } from "../type";
import dotenv from "dotenv";
import { showLatestGenImg } from "../utils/image";
import { pluginRegistry } from "../plugin";

dotenv.config();

export const imageGenerationServer: ImageGenerationServer = (
  process.env.IMAGE_GENERATION_SERVER || ""
).toLowerCase() as ImageGenerationServer;

const getImageGenerationTool = (): LLMTool | null => {
  if (!imageGenerationServer) return null;

  const imageGenerationTools: LLMTool[] = [];
  try {
    const provider = pluginRegistry.activatePluginSync<"image-generation">(
      "image-generation",
      imageGenerationServer,
    );
    provider.addImageGenerationTools(imageGenerationTools);
  } catch (e: any) {
    console.warn(e.message);
  }

  return imageGenerationTools.find((tool) => tool.function.name === "generateImage") || null;
};

const imageGenerationTools: LLMTool[] = imageGenerationServer
  ? [
      {
        type: "function",
        function: {
          name: "generateImage",
          description: "Generate or draw an image from a text prompt",
          parameters: {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                description: "The text prompt to generate the image from",
              },
              withImageContext: {
                type: "boolean",
                description:
                  "When user mentions 'this image/picture/photo' or similar, set this to true, the tools will request and provide context from the latest showed image",
              },
            },
            required: ["prompt"],
          },
        },
        func: async (params: { prompt: string; withImageContext: boolean }) => {
          const tool = getImageGenerationTool();
          if (!tool) return `${ToolReturnTag.Error}Image generation is not available.`;
          return tool.func(params);
        },
      },
      {
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
      },
    ]
  : [];

export const addImageGenerationTools = (tools: LLMTool[]) => {
  console.log(
    `Image generation tools added: ${imageGenerationTools.map((t) => t.function.name).join(", ")}`,
  );
  tools.push(...imageGenerationTools);
};
