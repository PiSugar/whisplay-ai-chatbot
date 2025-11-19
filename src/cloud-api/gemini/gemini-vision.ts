import { LLMTool, ToolReturnTag } from "../../type";
import { gemini, geminiVisionModel } from "./gemini";
import dotenv from "dotenv";
import { getLatestShowedImage } from "../../utils/image";
import { readFileSync } from "fs";

dotenv.config();

export const addGeminiVisionTool = (visionTools: LLMTool[]) => {
  if (!gemini) {
    return;
  }
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
      const { prompt } = params;
      let imgPath = getLatestShowedImage();
      if (!imgPath) {
        return `${ToolReturnTag.Error} No image is found.`;
      }
      const base64ImageFile = readFileSync(imgPath, { encoding: "base64" });
      const contents = [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: base64ImageFile,
          },
        },
        { text: prompt },
      ];
      const response = await gemini!.models.generateContent({
        model: geminiVisionModel,
        contents: contents,
      });
      const content = response.text;
      return (
        `${ToolReturnTag.Success}${content}` ||
        `${ToolReturnTag.Error} No content received from Ollama.`
      );
    },
  });
};
