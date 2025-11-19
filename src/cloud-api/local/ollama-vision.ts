import { VisionServer, LLMTool, ToolReturnTag } from "../../type";
import axios from "axios";
import dotenv from "dotenv";
import { getLatestShowedImage, showLatestCapturedImg } from "../../utils/image";
import { get } from "lodash";
import { readFileSync } from "fs";

dotenv.config();

const ollamaEndpoint = process.env.OLLAMA_ENDPOINT || "http://localhost:11434";
const ollamaVisionModel = process.env.OLLAMA_VISION_MODEL || "qwen3-vl:2b";

export const addOllamaVisionTool = (visionTools: LLMTool[]) => {
  visionTools.push({
    type: "function",
    function: {
      name: "describeImage",
      description:
        "Analyze and interpret an image with the help of vision model, e.g., describe the image content or answer questions about the image.",
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
      const { prompt } = params;
      let imgPath = getLatestShowedImage();
      if (!imgPath) {
        return `${ToolReturnTag.Error} No image is found.`;
      }
      const fileData = readFileSync(imgPath).toString("base64");
      const response = await axios.post(`${ollamaEndpoint}/api/chat`, {
        model: ollamaVisionModel,
        messages: [
          {
            role: "user",
            content: `${prompt} Respond no more than 100 words.`,
            images: [fileData],
          },
        ],
        think: false,
        stream: false,
      });
      const content = get(response.data, "message.content", "");
      return (
        `${ToolReturnTag.Response}${content}` ||
        `${ToolReturnTag.Error} No content received from Ollama.`
      );
    },
  });
};
