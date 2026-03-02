import { LLMTool, ToolReturnTag } from "../../type";
import {
  getLatestShowedImage,
  setLatestGenImg,
} from "../../utils/image";
import { imageDir } from "../../utils/dir";
import path from "path";
import { readFileSync, writeFileSync } from "fs";
import { defaultPortMap } from "./common";
import axios from "axios";

const llm8850lcmHost =
  process.env.LLM8850LCM_HOST || "127.0.0.1";
const llm8850lcmPort =
  process.env.LLM8850LCM_PORT || String(defaultPortMap.llm8850lcm);
const llm8850lcmBaseUrl = `http://${llm8850lcmHost}:${llm8850lcmPort}`;

export const addLlm8850lcmGenerationTool = (
  imageGenerationTools: LLMTool[],
) => {
  imageGenerationTools.push({
    type: "function",
    function: {
      name: "generateImage",
      description:
        "Generate or draw an image from a text prompt, or edit an image based on a text prompt.",
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
      console.log(
        `Generating image with llm8850lcm at ${llm8850lcmBaseUrl}`,
      );
      const { prompt, withImageContext } = params;

      const body: Record<string, any> = {
        prompt,
        return_base64: true,
      };

      // img2img: attach the latest showed image as base64 input
      if (withImageContext) {
        const latestImgPath = getLatestShowedImage();
        if (latestImgPath) {
          const base64Image = readFileSync(latestImgPath, {
            encoding: "base64",
          });
          body.init_image_base64 = base64Image;
        }
      }

      try {
        const { data } = await axios.post<{
          seed: number;
          width: number;
          height: number;
          save_path: string | null;
          image_base64?: string;
        }>(`${llm8850lcmBaseUrl}/generate`, body, {
          headers: { "Content-Type": "application/json" },
        });

        if (!data.image_base64) {
          return `${ToolReturnTag.Error}Image generation returned no image data.`;
        }

        const fileName = `llm8850lcm-image-${Date.now()}.png`;
        const imagePath = path.join(imageDir, fileName);
        const buffer = Buffer.from(data.image_base64, "base64");
        writeFileSync(imagePath, buffer);
        setLatestGenImg(imagePath);
        console.log(
          `Image saved as ${imagePath} (seed=${data.seed}, ${data.width}x${data.height})`,
        );

        return `${ToolReturnTag.Success}Image file saved.`;
      } catch (error) {
        const errMsg =
          axios.isAxiosError(error) && error.response?.data?.error
            ? String(error.response.data.error)
            : error instanceof Error
              ? error.message
              : "Unknown error";
        console.error("Error generating image with llm8850lcm:", error);
        return `${ToolReturnTag.Error}Image generation failed: ${errMsg}`;
      }
    },
  });
};
