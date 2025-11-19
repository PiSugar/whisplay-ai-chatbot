import { LLMTool, ToolReturnTag } from "../../type";
import dotenv from "dotenv";
import { getLatestShowedImage } from "../../utils/image";
import { get } from "lodash";
import { readFileSync } from "fs";
import { volcengineVisionModel, doubaoAccessToken } from "./volcengine";
import axios from "axios";

dotenv.config();

export const addVolcengineVisionTool = (visionTools: LLMTool[]) => {
  // Add Volcengine vision tools here
  if (!doubaoAccessToken) {
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
      const fileData = readFileSync(imgPath, { encoding: "base64" });
      try {
        const response = await axios.post(
          "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
          {
            model: volcengineVisionModel,
            messages: [
              {
                role: "user",
                content: [
                  {
                    image_url: {
                      url: `data:image/jpeg;base64,${fileData}`,
                    },
                    type: "image_url",
                  },
                  {
                    text: prompt,
                    type: "text",
                  },
                ],
              },
            ],
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${doubaoAccessToken}`,
            },
          }
        );
        const data = response.data;
        const content = get(data, "choices[0].message.content", "");
        return (
          `${ToolReturnTag.Success}${content}` ||
          `${ToolReturnTag.Error} No content received from OpenAI.`
        );
      } catch (error) {
        console.error("Error during OpenAI vision request:", error);
        return `${ToolReturnTag.Error} Failed to analyze the image.`;
      }
    },
  });
};
