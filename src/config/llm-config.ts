require("dotenv").config();

// default 5 minutes
export const CHAT_HISTORY_RESET_TIME = parseInt(process.env.CHAT_HISTORY_RESET_TIME || "" + 1000 * 60 * 5, 10);

export let lastMessageTime = 0;

export const updateLastMessageTime = (): void => {
  lastMessageTime = Date.now();
}

export const shouldResetChatHistory = (): boolean => {
  return Date.now() - lastMessageTime > CHAT_HISTORY_RESET_TIME;
}

export const systemPrompt =
  process.env.SYSTEM_PROMPT ||
  "You are a young and cheerful girl who loves to talk, chat, help others, and learn new things. You enjoy using emoji expressions.";

interface LLMTool {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: {
        [key: string]: {
          type: string;
          description: string;
        };
      };
      required?: string[];
    };
  };
  func: (params: any) => Promise<string>;
}

export const llmTools: LLMTool[] = [
  // 调整音量大小
  // {
  //   type: "function",
  //   function: {
  //     name: "setVolume",
  //     description: "直接设置具体音量大小",
  //     parameters: {
  //       type: "object",
  //       properties: {
  //         volume: {
  //           type: "number",
  //           description: "音量大小，范围从0到100，0表示最小音量，100表示最大音量",
  //         },
  //       },
  //       required: ["volume"],
  //     },
  //   },
  //   func: async (params) => {
  //     const { volume } = params;
  //     if (volume >= 0 && volume <= 100) {
  //       // 调用音量设置的API
  //       return `已设置音量为 ${volume}`;
  //     } else {
  //       console.error("音量范围错误");
  //       return "音量范围错误，请设置在0到100之间";
  //     }
  //   },
  // },
  // // 增加音量
  // {
  //   type: "function",
  //   function: {
  //     name: "increaseVolume",
  //     description: "增加音量",
  //   },
  //   func: async () => {
  //     // 调用音量增加的API
  //     return "增加音量完成";
  //   },
  // },
  // // 减小音量
  // {
  //   type: "function",
  //   function: {
  //     name: "decreaseVolume",
  //     description: "减小音量",
  //   },
  //   func: async () => {
  //     // 调用音量减小的API
  //     return "减小音量完成";
  //   },
  // },
];

export const llmFuncMap = llmTools.reduce((acc, tool) => {
  acc[tool.function.name] = tool.func;
  return acc;
}, {} as Record<string, (params: any) => Promise<string>>);
