import { LLMTool } from "../type";
import { readdirSync, writeFileSync } from "fs";
import path, { resolve } from "path";
import { setVolumeByAmixer, getCurrentLogPercent } from "../utils/volume";
import { cloneDeep } from "lodash";
import { transformToGeminiType } from "../utils";
import { gemini } from "../cloud-api/gemini";
import { GenerateContentResponse } from "@google/genai";
import { imageDir } from "../utils/dir";
import dotenv from "dotenv";
import { setLatestGenImg } from "../utils/image";

dotenv.config();

const geminiImageModel = process.env.GEMINI_IMAGE_MODEL;

const defaultTools: LLMTool[] = [
  {
    type: "function",
    function: {
      name: "setVolume",
      description: "set the volume level",
      parameters: {
        type: "object",
        properties: {
          percent: {
            type: "number",
            description: "the volume level to set (0-100)",
          },
        },
        required: ["percent"],
      },
    },
    func: async (params) => {
      const { percent } = params;
      if (percent >= 0 && percent <= 100) {
        setVolumeByAmixer(percent);
        return `Volume set to ${percent}%`;
      } else {
        console.error("Volume range error");
        return "Volume range error, please set between 0 and 100";
      }
    },
  },
  // increase volume
  {
    type: "function",
    function: {
      name: "increaseVolume",
      description: "increase the volume level by a specified amount",
      parameters: {},
    },
    func: async (params) => {
      const currentLogPercent = getCurrentLogPercent();
      if (currentLogPercent >= 100) {
        return "Volume is already at maximum";
      }
      const newAmixerValue = Math.min(currentLogPercent + 10, 100);
      setVolumeByAmixer(newAmixerValue);
      console.log(
        `Current volume: ${currentLogPercent}%, New volume: ${newAmixerValue}%`
      );
      return `Volume increased by 10%, now at ${newAmixerValue}%`;
    },
  },
  // decrease volume
  {
    type: "function",
    function: {
      name: "decreaseVolume",
      description: "decrease the volume level by a specified amount",
      parameters: {},
    },
    func: async (params) => {
      const currentLogPercent = getCurrentLogPercent();
      if (currentLogPercent <= 0) {
        return "Volume is already at minimum";
      }
      const newAmixerValue = Math.max(currentLogPercent - 10, 0);
      setVolumeByAmixer(newAmixerValue);
      console.log(
        `Current volume: ${currentLogPercent}%, New volume: ${newAmixerValue}%`
      );
      return `Volume decreased by 10%, now at ${newAmixerValue}%`;
    },
  },
];

if (gemini && geminiImageModel) {
  defaultTools.push({
    type: "function",
    function: {
      name: "generateImage",
      description: "Generate an image from a text prompt",
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
        ? `[success](${imagePath})`
        : "[error]Image generation failed";
    },
  });
}

// 如果有custom-tools文件夹，收集custom-tools文件夹中的文件导出的所有tools
const customTools: LLMTool[] = [];
const customToolsFolderPath = resolve(__dirname, "./custom-tools");
try {
  // 遍历 custom-tools文件夹中的所有文件
  readdirSync(customToolsFolderPath).forEach((file) => {
    const filePath = resolve(customToolsFolderPath, file);
    // 只处理.ts和.js文件
    if (file.endsWith(".ts") || file.endsWith(".js")) {
      try {
        // 动态导入文件
        const toolModule = require(filePath);
        if (toolModule.default && Array.isArray(toolModule.default)) {
          customTools.push(...toolModule.default);
        } else if (toolModule.llmTools && Array.isArray(toolModule.llmTools)) {
          customTools.push(...toolModule.llmTools);
        }
      } catch (error) {
        console.error(`Error loading tool from ${filePath}:`, error);
      }
    }
  });
} catch (error) {
  console.error("Error loading custom tools:", error);
}

// remove geminiType from parameters for OpenAI compatibility
export const llmTools: LLMTool[] = [...defaultTools, ...customTools];

export const llmToolsForGemini: LLMTool[] = [
  ...defaultTools,
  ...customTools,
].map((tool) => {
  const newTool = cloneDeep(tool);
  if (newTool.function && newTool.function.parameters) {
    newTool.function.parameters = transformToGeminiType(
      newTool.function.parameters
    );
  }
  return newTool;
});

export const llmFuncMap = llmTools.reduce((acc, tool) => {
  acc[tool.function.name] = tool.func;
  return acc;
}, {} as Record<string, (params: any) => Promise<string>>);
