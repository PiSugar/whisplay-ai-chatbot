const { OpenAI } = require("openai");
const { systemPrompt } = require("../config/llm-config");
require("dotenv").config();

const apiKey = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
  apiKey,
});

const messages = [
  {
    role: "system",
    content: systemPrompt,
  },
];

const resetChatHistory = () => {
  messages.length = 0;
  messages.push({
    role: "system",
    content: systemPrompt,
  });
}

const chatWithLLM = async (userMessage) => {
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

const chatWithLLMStream = async (inputMessages = [], partialCallback, endCallback) => {
  console.time("llm");
  messages.push(...inputMessages);
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
  chatWithLLM,
  chatWithLLMStream,
  resetChatHistory,
};
