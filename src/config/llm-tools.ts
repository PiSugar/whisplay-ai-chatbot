import { LLMTool } from "../type";
import { execSync } from "child_process";


const getVolumePercentage = (): number => {
  // amixer -c 1 get Speaker
  // Capabilities: volume
  // Playback channels: Front Left - Front Right
  // Limits: Playback 0 - 127
  // Mono:
  // Front Left: Playback 121 [95%] [0.00dB]
  // Front Right: Playback 121 [95%] [0.00dB]
  const output = execSync("amixer -c 1 get Speaker").toString();
  const regex = /Front Left: Playback (\d+) \[(\d+)%\]/;
  const match = output.match(regex);
  if (match && match[2]) {
    const volume = parseInt(match[2], 10);
    return volume;
  }
  return 40; // Default to min if not found
};

export const llmTools: LLMTool[] = [
  {
    type: "function",
    function: {
      name: "setVolume",
      description: "set the volume level",
      parameters: {
        type: "object",
        properties: {
          volume: {
            type: "number",
            description: "the volume level to set (0-100)",
          },
        },
        required: ["volume"],
      },
    },
    func: async (params) => {
      const { volume } = params;
      if (volume >= 0 && volume <= 100) {
        execSync(`amixer -c 1 set Speaker ${volume}%`);
        console.log(`Volume set to ${volume}%`);
        return `Volume set to ${volume}`;
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
      const currentVolume = getVolumePercentage();
      const newVolume = Math.min(currentVolume + 10, 0);
      execSync(`amixer -c 1 set Speaker ${newVolume}%`);
      console.log(`Volume increased to ${newVolume}%`);
      return `Volume increased by 10%, now at ${newVolume}%`;
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
      const currentVolume = getVolumePercentage();
      const newVolume = Math.max(currentVolume - 10, 40);
      execSync(`amixer -c 1 set Speaker ${newVolume}%`);
      console.log(`Volume decreased to ${newVolume}%`);
      return `Volume decreased by 10%, now at ${newVolume}%`;
    },
  },
  // mute volume
];

export const llmFuncMap = llmTools.reduce((acc, tool) => {
  acc[tool.function.name] = tool.func;
  return acc;
}, {} as Record<string, (params: any) => Promise<string>>);
