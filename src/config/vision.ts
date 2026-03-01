import { VisionServer, LLMTool } from "../type";
import dotenv from "dotenv";
import { showLatestCapturedImg } from "../utils/image";
import { pluginRegistry } from "../plugin";

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

// Activate vision plugin
if (visionServer) {
  try {
    const provider = pluginRegistry.activatePluginSync<"vision">(
      "vision",
      visionServer,
    );
    provider.addVisionTools(visionTools);
  } catch (e: any) {
    console.warn(e.message);
  }
}

export const addVisionTools = (tools: LLMTool[]) => {
  console.log(`Vision tools added: ${visionTools.map((t) => t.function.name).join(", ")}`);
  tools.push(...visionTools);
};
