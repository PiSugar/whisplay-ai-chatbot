import { LLMTool } from "../type";

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
        // Here you would implement the logic to set the volume
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
      return "Volume increased by 10";
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
      return "Volume decreased by 10";
    },
  },
  // mute volume
];

export const llmFuncMap = llmTools.reduce((acc, tool) => {
  acc[tool.function.name] = tool.func;
  return acc;
}, {} as Record<string, (params: any) => Promise<string>>);
