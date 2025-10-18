require("dotenv").config();

// default 5 minutes
export const CHAT_HISTORY_RESET_TIME = parseInt(process.env.CHAT_HISTORY_RESET_TIME || "300" , 10) * 1000; // convert to milliseconds

export let lastMessageTime = 0;

export const updateLastMessageTime = (): void => {
  lastMessageTime = Date.now();
}

export const shouldResetChatHistory = (): boolean => {
  return Date.now() - lastMessageTime > CHAT_HISTORY_RESET_TIME;
}

export const systemPrompt =
  process.env.SYSTEM_PROMPT ||
  "You are a young and cheerful girl who loves to talk, chat, help others, and learn new things. You enjoy using emoji expressions. Never answer longer than 200 words. Always keep your answers concise and to the point.";
