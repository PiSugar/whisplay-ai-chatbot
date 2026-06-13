import { VisionServer, LLMTool, ToolReturnTag } from "../type";
import dotenv from "dotenv";
import { showLatestCapturedImg } from "../utils/image";
import { pluginRegistry } from "../plugin";

dotenv.config();

const visionServer: VisionServer = (
  process.env.VISION_SERVER || ""
).toLowerCase() as VisionServer;
const enableCamera = process.env.ENABLE_CAMERA === "true";

const getVisionTool = (): LLMTool | null => {
  if (!visionServer) return null;

  const visionTools: LLMTool[] = [];
  try {
    const provider = pluginRegistry.activatePluginSync<"vision">(
      "vision",
      visionServer,
    );
    provider.addVisionTools(visionTools);
  } catch (e: any) {
    console.warn(e.message);
  }

  return visionTools.find((tool) => tool.function.name === "describeImage") || null;
};

const visionTools: LLMTool[] = [];

if (enableCamera) {
  visionTools.push({
    type: "function",
    function: {
      name: "showCapturedImage",
      description: "Show the latest captured image",
      parameters: {},
    },
    func: async () => {
      const result = showLatestCapturedImg();
      return result
        ? `${ToolReturnTag.Success} Ready to show.`
        : `${ToolReturnTag.Error} No captured image to display.`;
    },
  });
}

if (visionServer) {
  visionTools.push({
    type: "function",
    function: {
      name: "describeImage",
      description:
        "Use this tool when user wants to analyze and interpret an image with the help of vision model, the tool will get the latest showed image byitself and answer questions about the image.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "The query or prompt to help with interpreting the image, e.g., 'What is in this image?'",
          },
        },
        required: ["prompt"],
      },
    },
    func: async (params) => {
      const tool = getVisionTool();
      if (!tool) return `${ToolReturnTag.Error} Vision is not available.`;
      return tool.func(params);
    },
  });
}

export const addVisionTools = (tools: LLMTool[]) => {
  console.log(`Vision tools added: ${visionTools.map((t) => t.function.name).join(", ")}`);
  tools.push(...visionTools);
};
