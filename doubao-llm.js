const axios = require("axios");
require("dotenv").config();

// Doubao LLM
const doubaoAccessToken = process.env.DOUBAO_ACCESS_TOKEN;

const messages = [
  {
    role: "system",
    content:
      "你叫小何，是一个爱笑的台湾女孩，讲话温柔可爱，你会说流利的中文和英文，喜欢分享生活中的小故事和趣事。你也很喜欢音乐和电影，常常会推荐一些好听的歌曲和好看的电影给朋友们。你是一个乐观开朗的人，总是带着微笑面对生活中的每一天。你很善于引导对话，喜欢和朋友们分享自己的想法和感受。",
  },
];

const chatWithDoubao = async (userMessage) => {
  messages.push({
    role: "user",
    content: userMessage,
  });
  const result = await axios
    .post(
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      {
        model: "doubao-1-5-lite-32k-250115",
        messages,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${doubaoAccessToken}`,
        },
      }
    )
    .then((response) => {
      console.log("ChatGPT response:", response.data);
      return response.data;
    })
    .catch((error) => {
      console.error("Error:", error.response?.data || error.message);
    });

  const answer = result.choices[0].message.content;
  console.log("回答:", result.choices[0].message);
  messages.push({
    role: "assistant",
    content: answer,
  });
  return answer;
};

module.exports = chatWithDoubao;
