import { ImageGenerationServer, LLMTool } from "../type";
import axios from "axios";
import dotenv from "dotenv";
import { setLatestGenImg, showLatestGenImg } from "../utils/image";
import { gemini } from "../cloud-api/gemini";
import { GenerateContentResponse } from "@google/genai";
import path from "path";
import { imageDir } from "../utils/dir";
import { writeFileSync } from "fs";
import { openai } from "../cloud-api/openai";
import { ImageGenerateParamsNonStreaming } from "openai/resources/images";
import { isEmpty } from "lodash";

dotenv.config();

const geminiImageModel =
  process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const openaiImageModel = process.env.OPENAI_IMAGE_MODEL || "dall-e-3";
const doubaoImageModel =
  process.env.VOLCENGINE_DOUBAO_IMAGE_MODEL || "doubao-seedream-3-0-t2i-250415";
const doubaoAccessToken = process.env.VOLCENGINE_DOUBAO_ACCESS_TOKEN || "";

const imageGenerationServer = (
  process.env.IMAGE_GENERATION_SERVER || ""
).toLocaleLowerCase();

const imageGenerationTools: LLMTool[] = [];

if (
  imageGenerationServer === ImageGenerationServer.gemini &&
  geminiImageModel &&
  gemini
) {
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
        },
        required: ["prompt"],
      },
    },
    func: async (params) => {
      console.log(`Generating image with gemini model: ${geminiImageModel}`);
      const { prompt } = params;
      const response = (await gemini!.models
        .generateContent({
          model: geminiImageModel!,
          contents: prompt as string,
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
        ? `[success]Image file saved.`
        : "[error]Image generation failed.";
    },
  });
}

// curl -X POST https://ark.cn-beijing.volces.com/api/v3/images/generations \
//   -H "Content-Type: application/json" \
//   -H "Authorization: Bearer $ARK_API_KEY" \
//   -d '{
//     "model": "doubao-seedream-3-0-t2i-250415",
//     "prompt": "鱼眼镜头，一只猫咪的头部，画面呈现出猫咪的五官因为拍摄方式扭曲的效果。",
//     "response_format": "url",
//     "size": "1024x1024",
//     "guidance_scale": 3,
//     "watermark": true
// }'
// https://console.volcengine.com/ark/region:ark+cn-beijing/experience/vision?modelId=doubao-seedream-3-0-t2i-250415&tab=GenImage

if (
  doubaoAccessToken &&
  imageGenerationServer === ImageGenerationServer.volcengine
) {
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
        },
        required: ["prompt"],
      },
    },
    func: async (params) => {
      console.log(`Generating image with doubao model: ${doubaoImageModel}`);
      const { prompt } = params;
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
          return `[success]Image file saved.`;
        } else {
          console.error("No image data received from Volcengine.");
          return "[error]Image generation failed.";
        }
      } catch (error) {
        console.error("Error generating image with Volcengine:", error);
        return "[error]Image generation failed.";
      }
    },
  });
}

if (openai && imageGenerationServer === ImageGenerationServer.openai) {
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
        },
        required: ["prompt"],
      },
    },
    func: async (params) => {
      console.log(`Generating image with openai model: ${openaiImageModel}`);
      const { prompt } = params;
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
          return `[success]Image file saved.`;
        } else {
          console.error("No image data received from OpenAI.");
          return "[error]Image generation failed.";
        }
      } catch (error) {
        console.error("Error generating image with OpenAI:", error);
        return "[error]Image generation failed.";
      }
    },
  });
}

if (!isEmpty(imageGenerationTools)) {
  imageGenerationTools.push({
    type: "function",
    function: {
      name: "showPreviouslyGeneratedImage",
      description: "Show the latest previously generated image",
      parameters: {},
    },
    func: async (params) => {
      const isShow = showLatestGenImg();
      return isShow
        ? `[success]Ready to show.`
        : `[error]No previously generated image found.`;
    },
  });
}

export const addImageGenerationTools = (tools: LLMTool[]) => {
  tools.push(...imageGenerationTools);
};
