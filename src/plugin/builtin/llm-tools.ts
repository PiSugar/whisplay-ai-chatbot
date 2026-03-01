import { pluginRegistry } from "../registry";
import { LLMToolsPlugin } from "../types";
import { LLMTool } from "../../type";

export function registerLLMToolsPlugins(): void {
  pluginRegistry.register({
    name: "volume-control",
    displayName: "Volume Control Tools",
    version: "1.0.0",
    type: "llm-tools",
    description: "Built-in volume control tools (set / increase / decrease)",
    activate: () => {
      const {
        setVolumeByAmixer,
        getCurrentLogPercent,
      } = require("../../utils/volume");
      return {
        getTools: (): LLMTool[] => [
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
            func: async (params: any) => {
              const { percent } = params;
              if (percent >= 0 && percent <= 100) {
                setVolumeByAmixer(percent);
                return `Volume set to ${percent}%`;
              }
              console.error("Volume range error");
              return "Volume range error, please set between 0 and 100";
            },
          },
          {
            type: "function",
            function: {
              name: "increaseVolume",
              description: "increase the volume level by a specified amount",
              parameters: {},
            },
            func: async () => {
              const currentLogPercent = getCurrentLogPercent();
              if (currentLogPercent >= 100) {
                return "Volume is already at maximum";
              }
              const newAmixerValue = Math.min(currentLogPercent + 10, 100);
              setVolumeByAmixer(newAmixerValue);
              console.log(
                `Current volume: ${currentLogPercent}%, New volume: ${newAmixerValue}%`,
              );
              return `Volume increased by 10%, now at ${newAmixerValue}%`;
            },
          },
          {
            type: "function",
            function: {
              name: "decreaseVolume",
              description: "decrease the volume level by a specified amount",
              parameters: {},
            },
            func: async () => {
              const currentLogPercent = getCurrentLogPercent();
              if (currentLogPercent <= 0) {
                return "Volume is already at minimum";
              }
              const newAmixerValue = Math.max(currentLogPercent - 10, 0);
              setVolumeByAmixer(newAmixerValue);
              console.log(
                `Current volume: ${currentLogPercent}%, New volume: ${newAmixerValue}%`,
              );
              return `Volume decreased by 10%, now at ${newAmixerValue}%`;
            },
          },
        ],
      };
    },
  } as LLMToolsPlugin);
}
