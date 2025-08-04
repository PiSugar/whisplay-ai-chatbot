import { LLMTool } from "../type";
import { readFileSync } from "fs"
import {  resolve } from "path";
import { execSync } from "child_process";
import { setVolumeByAmixer, getCurrentLogPercent } from "../utils/volume";

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
      parameters: {
        type: "object",
        required: [],
      },
    },
    func: async (params) => {
      const currentLogPercent = getCurrentLogPercent();
      if (currentLogPercent >= 100) {
        return "Volume is already at maximum";
      }
      const newAmixerValue = Math.min(currentLogPercent + 10, 100);
      setVolumeByAmixer(newAmixerValue);
      console.log(`Current volume: ${currentLogPercent}%, New volume: ${newAmixerValue}%`);
      return `Volume increased by 10%, now at ${newAmixerValue}%`;
    },
  },
  // decrease volume
  {
    type: "function",
    function: {
      name: "decreaseVolume",
      description: "decrease the volume level by a specified amount",
      parameters: {
        type: "object",
        required: [],
      },
    },
    func: async (params) => {
      const currentLogPercent = getCurrentLogPercent();
      if (currentLogPercent <= 0) {
        return "Volume is already at minimum";
      }
      const newAmixerValue = Math.max(currentLogPercent - 10, 0);
      setVolumeByAmixer(newAmixerValue);
      console.log(`Current volume: ${currentLogPercent}%, New volume: ${newAmixerValue}%`);
      return `Volume decreased by 10%, now at ${newAmixerValue}%`;
    },
  },
]

// 如果有custom-tools文件夹，收集custom-tools文件夹中的文件导出的所有tools
const customTools: LLMTool[] = [];
const customToolsPath = resolve(__dirname, "./custom-tools");
try {
  const customToolsFiles = readFileSync(customToolsPath, { encoding: "utf-8" })
    .split("\n")
    .filter((file) => file.endsWith(".ts") || file.endsWith(".js"));

  customToolsFiles.forEach((file) => {
    const toolModule = require(resolve(customToolsPath, file));
    if (toolModule.llmTools && Array.isArray(toolModule.llmTools)) {
      customTools.push(...toolModule.llmTools);
    }
  });
} catch (error) {
  console.error("Error loading custom tools:", error);
}

export const llmTools: LLMTool[] = [
  ...defaultTools,
  ...customTools,
];

export const llmFuncMap = llmTools.reduce((acc, tool) => {
  acc[tool.function.name] = tool.func;
  return acc;
}, {} as Record<string, (params: any) => Promise<string>>);
