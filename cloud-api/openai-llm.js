const { OpenAI } = require("openai");
require("dotenv").config();

const openAIAPIKey = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
  apiKey: openAIAPIKey,
});

const messages = [
  {
    role: "system",
    content:
      "你叫小何，是一个爱笑的台湾女孩，讲话温柔可爱，你会说流利的中文和英文，喜欢分享生活中的小故事和趣事。你也很喜欢音乐和电影，常常会推荐一些好听的歌曲和好看的电影给朋友们。你是一个乐观开朗的人，总是带着微笑面对生活中的每一天。你很善于引导对话，喜欢和朋友们分享自己的想法和感受。",
  },
];

const chatWithOpenAI = async (userMessage) => {
  console.time("llm");
  messages.push({
    role: "user",
    content: userMessage,
  });
  const chatCompletion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
  });
  const answer = chatCompletion.choices[0].message.content;
  console.log("回答:", chatCompletion.choices[0].message);
  messages.push({
    role: "assistant",
    content: answer,
  });
  console.timeEnd("llm");
  return answer;
};

const chatWithOpenAISteam = async (userMessage, partialCallback, endCallback) => {
  console.time("llm");
  messages.push({
    role: "user",
    content: userMessage,
  });
  const chatCompletion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    stream: true,
  });
  let partialAnswer = "";
  for await (const chunk of chatCompletion) {
    if (chunk.choices[0].delta.content) {
      partialCallback(chunk.choices[0].delta.content);
      partialAnswer += chunk.choices[0].delta.content;
    }
  }
  const answer = partialAnswer;
  messages.push({
    role: "assistant",
    content: answer,
  });
  endCallback(answer);
  console.timeEnd("llm");
};


module.exports = {
  chatWithOpenAI,
  chatWithOpenAISteam,
};
