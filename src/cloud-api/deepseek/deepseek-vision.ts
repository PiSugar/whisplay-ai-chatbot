import fs from "fs";
import { LLMTool, ToolReturnTag } from "../../type";
import { getLatestShowedImage, getImageMimeType } from "../../utils/image";
import { deepseek, deepseekVisionModel } from "./deepseek";

export const addDeepseekVisionTool = (visionTools: LLMTool[]): void => {
  const client = deepseek;
  if (!client) return;

  visionTools.push({
    type: "function",
    function: {
      name: "describeImage",
      description:
        "Analyze or read text from the latest displayed image with DeepSeek Vision.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Question or instruction about the image.",
          },
        },
        required: ["prompt"],
      },
    },
    func: async (params: any) => {
      const prompt = params?.prompt || "Describe this image.";
      const imagePath = getLatestShowedImage();
      if (!imagePath) return `${ToolReturnTag.Error} No image is found.`;

      const mime = getImageMimeType(imagePath) || "image/jpeg";
      const imageUrl = `data:${mime};base64,${fs.readFileSync(imagePath).toString("base64")}`;
      try {
        const response = await client.responses.create({
          model: deepseekVisionModel,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                { type: "input_image", image_url: imageUrl, detail: "auto" },
              ],
            },
          ],
        } as any);
        const content = response.output_text || "";
        return content
          ? `${ToolReturnTag.Success}${content}`
          : `${ToolReturnTag.Error} No content received from DeepSeek.`;
      } catch (error: any) {
        console.error("[DeepSeek Vision] Request failed:", error.message);
        return `${ToolReturnTag.Error} Failed to analyze the image.`;
      }
    },
  });
};
