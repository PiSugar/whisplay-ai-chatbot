import { VisionServer, LLMTool } from "../type";
import axios from "axios";
import dotenv from "dotenv";
import { getLatestCapturedImg, showLatestCapturedImg } from "../utils/image";
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
      name: "understandImageWithOllama",
      description:
        "Understand the content of an image using Ollama's vision model",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "The text prompt to assist image understanding, for example: 'What is in this image?'",
          },
        },
        required: ["prompt"],
      },
    },
    func: async (params) => {
      const imgPath = getLatestCapturedImg();
      if (!imgPath) {
        return "[error] No captured image is found.";
      }
      const { prompt } = params;
      const fileData = readFileSync(imgPath).toString("base64");
      const response = await axios.post(`${ollamaEndpoint}/api/chat`, {
        model: ollamaVisionModel,
        messages: [
          {
            role: "user",
            content: prompt,
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
