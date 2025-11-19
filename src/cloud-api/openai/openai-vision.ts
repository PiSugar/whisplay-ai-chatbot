import { LLMTool, ToolReturnTag } from "../../type";
import { getLatestShowedImage } from "../../utils/image";
import { get } from "lodash";
import { readFileSync } from "fs";
import { openai, openaiVisionModel } from "../../cloud-api/openai/openai";

export const addOpenaiVisionTool = (visionTools: LLMTool[]) => {
  // Add OpenAI vision tools here
  if (!openai) {
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
        const response = await openai!.chat.completions.create({
          model: openaiVisionModel,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${fileData}`,
                  },
                },
              ],
            },
          ],
        });
        const content = get(response, "choices[0].message.content", "");
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
