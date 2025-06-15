import { OpenAI } from "openai";
import {
  shouldResetChatHistory,
  systemPrompt,
  updateLastMessageTime,
} from "../config/llm-config";
import dotenv from "dotenv";
import { Message } from "../type";

dotenv.config();

const apiKey = process.env.OPENAI_API_KEY;

const openai = apiKey
  ? new OpenAI({
      apiKey,
    })
  : null;

const messages: Message[] = [
  {
    role: "system",
    content: systemPrompt,
  },
];

const resetChatHistory = (): void => {
  messages.length = 0;
  messages.push({
    role: "system",
    content: systemPrompt,
  });
};

const chatWithLLM = async (userMessage: string): Promise<string> => {
  if (!openai) {
    console.error("OpenAI API key is not set.");
    return "";
  }
  if (shouldResetChatHistory()) {
    resetChatHistory();
  }
  updateLastMessageTime();
  console.time("llm");
  messages.push({
    role: "user",
    content: userMessage,
  });
  const chatCompletion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: messages as any,
  });
  const answer = chatCompletion.choices[0].message.content as string;
  console.log("回答:", chatCompletion.choices[0].message);
  messages.push({
    role: "assistant",
    content: answer,
  });
  console.timeEnd("llm");
  return answer;
};

const chatWithLLMStream = async (
  inputMessages: Message[] = [],
  partialCallback: (partial: string) => void,
  endCallback: (finalAnswer: string) => void
): Promise<void> => {
  if (!openai) {
    console.error("OpenAI API key is not set.");
    return;
  }
  console.time("llm");
  messages.push(...inputMessages);
  const chatCompletion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: messages as any,
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

export { chatWithLLM, chatWithLLMStream, resetChatHistory };
