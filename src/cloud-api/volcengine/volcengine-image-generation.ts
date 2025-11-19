import { LLMTool, ToolReturnTag } from "../../type";
import axios from "axios";
import {
  getImageMimeType,
  getLatestShowedImage,
  setLatestGenImg,
} from "../../utils/image";
import path from "path";
import { imageDir } from "../../utils/dir";
import { readFileSync, writeFileSync } from "fs";
import { doubaoAccessToken, doubaoImageModel } from "./volcengine";

export const addVolcengineGenerationTool = (
  imageGenerationTools: LLMTool[]
) => {
  if (!doubaoAccessToken) return;
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
          // withImageContext: {
          //   type: "boolean",
          //   description:
          //     "Whether to use the image context in the conversation for generation",
          // },
        },
        required: ["prompt"],
      },
    },
    func: async (params: { prompt: string; withImageContext: boolean }) => {
      console.log(`Generating image with doubao model: ${doubaoImageModel}`);
      const { prompt, withImageContext } = params;
      let imageUrl = undefined;
      // if (withImageContext) {
      //   const latestImgPath = getLatestShowedImage();
      //   if (latestImgPath) {
      //     const base64ImageFile = readFileSync(latestImgPath, {
      //       encoding: "base64",
      //     });
      //     imageUrl = `data:${getImageMimeType(
      //       latestImgPath
      //     )};base64,${base64ImageFile}`;
      //   }
      // }
      try {
        const response = await axios.post(
          "https://ark.cn-beijing.volces.com/api/v3/images/generations",
          {
            model: doubaoImageModel,
            prompt: prompt,
            response_format: "b64_json",
            size: "1024x1024",
            guidance_scale: 3,
            watermark: false,
            image: imageUrl, // Note: not all models support image input
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${doubaoAccessToken}`,
            },
          }
        );
        const data = response.data;
        if (data && data.data && data.data.length > 0) {
          const imageData = data.data[0].b64_json;
          const buffer = Buffer.from(imageData, "base64");
          const fileName = `volcengine-image-${Date.now()}.jpg`;
          const imagePath = path.join(imageDir, fileName);
          writeFileSync(imagePath, buffer);
          setLatestGenImg(imagePath);
          console.log(`Image saved as ${imagePath}`);
          return `${ToolReturnTag.Success}Image file saved.`;
        } else {
          console.error("No image data received from Volcengine.");
          return `${ToolReturnTag.Error}Image generation failed.`;
        }
      } catch (error) {
        console.error("Error generating image with Volcengine:", error);
        return `${ToolReturnTag.Error}Image generation failed.`;
      }
    },
  });
};
