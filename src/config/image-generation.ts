import { ImageGenerationServer, LLMTool, ToolReturnTag } from "../type";
import dotenv from "dotenv";
import {
  showLatestGenImg,
} from "../utils/image";
import { isEmpty } from "lodash";
import { addGeminiGenerationTool } from "../cloud-api/gemini/gemini-image-generation";
import { addOpenaiGenerationTool } from "../cloud-api/openai/openai-image-generation";
import { addVolcengineGenerationTool } from "../cloud-api/volcengine/volcengine-image-generation";

dotenv.config();

const imageGenerationServer = (
  process.env.IMAGE_GENERATION_SERVER || ""
).toLocaleLowerCase();

const imageGenerationTools: LLMTool[] = [];

switch (imageGenerationServer) {
  case ImageGenerationServer.gemini:
    addGeminiGenerationTool(imageGenerationTools);
    break;
  case ImageGenerationServer.openai:
    addOpenaiGenerationTool(imageGenerationTools);
    break;
  case ImageGenerationServer.volcengine:
    addVolcengineGenerationTool(imageGenerationTools);
    break;
  default:
    break;
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
  tools.push(...imageGenerationTools);
};
