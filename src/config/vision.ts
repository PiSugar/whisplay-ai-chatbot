import { VisionServer, LLMTool } from "../type";
import dotenv from "dotenv";
import { showLatestCapturedImg } from "../utils/image";
import { addOllamaVisionTool } from "../cloud-api/local/ollama-vision";
import { addOpenaiVisionTool } from "../cloud-api/openai/openai-vision";
import { addGeminiVisionTool } from "../cloud-api/gemini/gemini-vision";
import { addVolcengineVisionTool } from "../cloud-api/volcengine/volcengine-vision";

dotenv.config();

const visionServer: VisionServer = (
  process.env.VISION_SERVER || ""
).toLowerCase() as VisionServer;
const enableCamera = process.env.ENABLE_CAMERA === "true";

const visionTools: LLMTool[] = [];

if (enableCamera) {
  visionTools.push({
    type: "function",
    function: {
      name: "showCapturedImage",
      description: "Show the latest captured image",
      parameters: {},
    },
    func: async (params) => {
      const result = showLatestCapturedImg();
      return result
        ? "[success] Ready to show."
        : "[error] No captured image to display.";
    },
  });
}

switch (visionServer) {
  case VisionServer.ollama:
    addOllamaVisionTool(visionTools);
    break;
  case VisionServer.openai:
    addOpenaiVisionTool(visionTools);
    break;
  case VisionServer.gemini:
    addGeminiVisionTool(visionTools);
    break;
  case VisionServer.volcengine:
    addVolcengineVisionTool(visionTools);
    break;
  default:
    break;
}

export const addVisionTools = (tools: LLMTool[]) => {
  console.log(`Vision tools added: ${visionTools.map((t) => t.function.name).join(", ")}`);
  tools.push(...visionTools);
};
