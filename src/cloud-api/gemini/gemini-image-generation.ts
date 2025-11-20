import { LLMTool, ToolReturnTag } from "../../type";
import {
  getImageMimeType,
  getLatestShowedImage,
  setLatestGenImg,
} from "../../utils/image";
import { gemini, geminiImageModel } from "./gemini";
import { GenerateContentResponse } from "@google/genai";
import path from "path";
import { imageDir } from "../../utils/dir";
import { readFileSync, writeFileSync } from "fs";


export const addGeminiGenerationTool = (imageGenerationTools: LLMTool[]) => {
  imageGenerationTools.push({
    type: "function",
    function: {
      name: "generateImage",
      description: "Generate or draw an image from a text prompt, or edit an image based on a text prompt.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "The text prompt to generate the image from",
          },
          withImageContext: {
            type: "boolean",
            description:
              "When user mentions 'this image/picture/photo' or similar, set this to true, the tools will request and provide context from the latest showed image",
          },
        },
        required: ["prompt"],
      },
    },
    func: async (params: { prompt: string; withImageContext: boolean }) => {
      console.log(`Generating image with gemini model: ${geminiImageModel}`);
      const { prompt, withImageContext } = params;
      let imageContext = undefined;
      if (withImageContext) {
        const latestImgPath = getLatestShowedImage();
        if (latestImgPath) {
          const base64ImageFile = readFileSync(latestImgPath, {
            encoding: "base64",
          });
          imageContext = {
            inlineData: {
              mimeType: getImageMimeType(latestImgPath),
              data: base64ImageFile,
            },
          };
        }
      }
      const response = (await gemini!.models
        .generateContent({
          model: geminiImageModel!,
          contents: [
            {
              text: prompt as string,
            },
            ...(imageContext ? [imageContext] : []),
          ],
          config: {
            imageConfig: {
              aspectRatio: "1:1",
            },
          },
        })
        .catch((err) => {
          console.error(`Error generating image:`, err);
        })) as GenerateContentResponse;
      const fileName = `gemini-image-${Date.now()}.png`;
      const imagePath = path.join(imageDir, fileName);
      let isSuccess = false;
      try {
        for (const part of response.candidates![0].content!.parts!) {
          if (part.text) {
            console.log(part.text);
          } else if (part.inlineData) {
            const imageData = part.inlineData.data!;
            const buffer = Buffer.from(imageData, "base64");
            writeFileSync(imagePath, buffer);
            setLatestGenImg(imagePath);
            isSuccess = true;
            console.log(`Image saved as ${imagePath}`);
          }
        }
      } catch (error) {
        console.error("Error saving image:", error);
      }
      return isSuccess
        ? `${ToolReturnTag.Success}Image file saved.`
        : `${ToolReturnTag.Error}Image generation failed.`;
    },
  });
};
