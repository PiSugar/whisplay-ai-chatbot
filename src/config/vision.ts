import { VisionServer, LLMTool } from "../type";
import axios from "axios";
import dotenv from "dotenv";
import {
  getLatestCapturedImg,
  getLatestGenImg,
  getLatestShowedImage,
  showLatestCapturedImg,
} from "../utils/image";
import { get } from "lodash";
import { readFileSync } from "fs";

dotenv.config();

const enableCamera = process.env.ENABLE_CAMERA === "true";

const visionServer = (process.env.VISION_SERVER || "").toLocaleLowerCase();

const ollamaEndpoint = process.env.OLLAMA_ENDPOINT || "http://localhost:11434";
const ollamaVisionModel = process.env.OLLAMA_VISION_MODEL || "qwen3-vl:2b";

const visionTools: LLMTool[] = [];

if (enableCamera) {
  visionTools.push({
    type: "function",
    function: {
      name: "showCapturedImage",
      description: "Show the lastest captured image",
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

if (visionServer === VisionServer.ollama) {
  visionTools.push({
    type: "function",
    function: {
      name: "imageInsight",
      description:
        "Automatically invoked **when the user asks about the contents of an image**, such as 'What can you see in the image?'. This function will analyze and describe the image.",
      parameters: {
        type: "object",
        properties: {
          imageType: {
            type: "enum",
            description:
              "Specifies which image to analyze. Default is `lastShowed`.",
            enum: ["lastShowed", "latestCaptured", "latestGenerated"],
          },
          prompt: {
            type: "string",
            description:
              "The query or prompt to help with interpreting the image, e.g., 'What is in this image?'",
          },
        },
        required: ["prompt", "imageType"],
      },
    },
    func: async (params) => {
      const { prompt, imageType = "latestShowed" } = params;
      let imgPath = getLatestShowedImage();
      if (imageType === "latestCaptured") {
        imgPath = getLatestCapturedImg();
      } else if (imageType == "latestGenerated") {
        imgPath = getLatestGenImg();
      }
      if (!imgPath) {
        return "[error] No image is found.";
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
        stream: false,
      });
      console.log("Ollama vision response:", response.data);
      const content = get(response.data, "message.content", "");
      return content || "[error] No content received from Ollama.";
    },
  });
}

export const addVisionTools = (tools: LLMTool[]) => {
  tools.push(...visionTools);
};
