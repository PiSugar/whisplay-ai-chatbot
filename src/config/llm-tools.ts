import { LLMTool } from "../type";
import { execSync } from "child_process";
import { dbPercentToLinear, linearToDbPercent } from "../utils/volume";


const getVolumeValue = (): number => {
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
  if (match && match[1]) {
    const volume = parseInt(match[1], 10);
    return volume;
  }
  return 0; // Default to min if not found
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
        const amixerValue = dbPercentToLinear(percent);
        execSync(`amixer -c 1 set Speaker ${amixerValue}%`);
        console.log(`Volume set to ${percent}% (${amixerValue} in amixer)`);
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
      const currentAmixerValue = getVolumeValue();
      const currentAlsaPercent = linearToDbPercent(currentAmixerValue);
      const newAlsaPercent = Math.min(currentAlsaPercent + 10, 100);
      const newAmixerValue = dbPercentToLinear(newAlsaPercent);
      console.log(`Current volume: ${currentAlsaPercent}%, New volume: ${newAlsaPercent}%`);
      // Set the new volume
      execSync(`amixer -c 1 set Speaker ${newAmixerValue}%`);
      console.log(`Volume increased to ${newAmixerValue}%`);
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
      const currentAmixerValue = getVolumeValue();
      const currentAlsaPercent = linearToDbPercent(currentAmixerValue);
      const newAlsaPercent = Math.max(currentAlsaPercent - 10, 0);
      const newAmixerValue = dbPercentToLinear(newAlsaPercent);
      console.log(`Current volume: ${currentAlsaPercent}%, New volume: ${newAlsaPercent}%`);
      // Set the new volume
      execSync(`amixer -c 1 set Speaker ${newAmixerValue}%`);
      console.log(`Volume decreased to ${newAmixerValue}%`);
      return `Volume decreased by 10%, now at ${newAmixerValue}%`;
    },
  },
  // mute volume
];

export const llmFuncMap = llmTools.reduce((acc, tool) => {
  acc[tool.function.name] = tool.func;
  return acc;
}, {} as Record<string, (params: any) => Promise<string>>);
