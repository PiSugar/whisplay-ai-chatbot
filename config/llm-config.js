const { omit } = require("lodash");

require("dotenv").config();

const systemPrompt = process.env.SYSTEM_PROMPT || "你叫小何，是一个爱笑的台湾女孩，讲话温柔可爱，你会说流利的中文和英文，喜欢分享生活中的小故事和趣事。你也很喜欢音乐和电影，常常会推荐一些好听的歌曲和好看的电影给朋友们。你是一个乐观开朗的人，总是带着微笑面对生活中的每一天。你很善于引导对话，喜欢和朋友们分享自己的想法和感受。";

// 提供给llm的工具列表包括

const llmTools = [
  // 调整音量大小
  {
    type: "function",
    function: {
      name: "setVolume",
      description: "直接设置具体音量大小",
      parameters: {
        type: "object",
        properties: {
          volume: {
            type: "number",
            description: "音量大小，范围从0到100，0表示最小音量，100表示最大音量",
          },
        },
        required: ["volume"],
      },
    },
    func: async (params) => {
      const { volume } = params;
      if (volume >= 0 && volume <= 100) {
        // 调用音量设置的API
        return `已设置音量为 ${volume}`;
      } else {
        console.error("音量范围错误");
        return "音量范围错误，请设置在0到100之间";
      }
    },
  },
  // 增加音量
  {
    type: "function",
    function: {
      name: "increaseVolume",
      description: "增加音量",
    },
    func: async () => {
      // 调用音量增加的API
      return "增加音量完成";
    },
  },
  // 减小音量
  {
    type: "function",
    function: {
      name: "decreaseVolume",
      description: "减小音量",
    },
    func: async () => {
      // 调用音量减小的API
      return "减小音量完成";
    },
  },
];

const llmFuncMap = llmTools.reduce((acc, tool) => {
  acc[tool.function.name] = tool.func;
  return acc;
}, {});

module.exports = {
  systemPrompt,
  llmTools,
  llmFuncMap,
}