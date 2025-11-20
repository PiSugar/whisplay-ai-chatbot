import { LLMTool, ToolReturnTag } from "../../type";
import {
  getImageMimeType,
  getLatestShowedImage,
  setLatestGenImg,
} from "../../utils/image";
import path from "path";
import { imageDir } from "../../utils/dir";
import { readFileSync, writeFileSync } from "fs";
import { openai, openaiImageModel } from "./openai";
import { ImageGenerateParamsNonStreaming } from "openai/resources/images";

export const addOpenaiGenerationTool = (imageGenerationTools: LLMTool[]) => {
  if (!openai) return;
  imageGenerationTools.push({
    type: "function",
    function: {
      name: "generateImage",
      description: "Generate or draw an image from a text prompt",
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
      console.log(`Generating image with openai model: ${openaiImageModel}`);
      const { prompt, withImageContext } = params;
      if (["dall-e-2", "dall-e-3"].includes(openaiImageModel)) {
        if (withImageContext) {
          console.warn(
            `OpenAI image generation with model ${openaiImageModel} does not support image context, ignoring the withImageContext parameter.`
          );
        }
        const requestParams: ImageGenerateParamsNonStreaming = {
          model: openaiImageModel,
          prompt: prompt as string,
          size: "1024x1024",
          n: 1,
        };
        if (["dall-e-2", "dall-e-3"].includes(openaiImageModel)) {
          requestParams.response_format = "b64_json";
        }
        try {
          const response = await openai!.images.generate(requestParams);
          if (response.data && response.data.length > 0) {
            const imageData = response.data[0].b64_json;
            const buffer = Buffer.from(imageData!, "base64");
            const fileName = `openai-image-${Date.now()}.jpg`;
            const imagePath = path.join(imageDir, fileName);
            writeFileSync(imagePath, buffer);
            setLatestGenImg(imagePath);
            console.log(`Image saved as ${imagePath}`);
            return `${ToolReturnTag.Success}Image file saved.`;
          } else {
            console.error("No image data received from OpenAI.");
            return `${ToolReturnTag.Error}Image generation failed.`;
          }
        } catch (error) {
          console.error("Error generating image with OpenAI:", error);
          return `${ToolReturnTag.Error}Image generation failed.`;
        }
      } else {
        let imageUrl = undefined;
        if (withImageContext) {
          const latestImgPath = getLatestShowedImage();
          if (latestImgPath) {
            const base64ImageFile = readFileSync(latestImgPath, {
              encoding: "base64",
            });
            imageUrl = `data:${getImageMimeType(
              latestImgPath
            )};base64,${base64ImageFile}`;
          }
        }
        try {
          const response = await openai!.responses.create({
            model: openaiImageModel,
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: prompt },
                  {
                    type: "input_image",
                    image_url: imageUrl,
                    detail: "auto",
                  },
                ],
              },
            ],
            tools: [{ type: "image_generation" }],
          });
          const imageData = response.output
            .filter((output) => output.type === "image_generation_call")
            .map((output) => output.result);

          if (imageData.length > 0) {
            const imageBase64 = imageData[0];
            const fs = await import("fs");
            const imagePath = path.join(
              imageDir,
              `openai-image-${Date.now()}.jpg`
            );
            fs.writeFileSync(imagePath, Buffer.from(imageBase64!, "base64"));
            setLatestGenImg(imagePath);
            console.log(`Image saved as ${imagePath}`);
            return `${ToolReturnTag.Success}Image file saved.`;
          } else {
            console.error("No image data received from OpenAI.");
            return `${ToolReturnTag.Error}Image generation failed.`;
          }
        } catch (error) {
          console.error("Error generating image with OpenAI:", error);
          return `${ToolReturnTag.Error}Image generation failed.`;
        }
      }
    },
  });
};
