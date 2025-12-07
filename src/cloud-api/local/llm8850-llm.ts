import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import {
  shouldResetChatHistory,
  systemPrompt,
  updateLastMessageTime,
} from "../../config/llm-config";
import dotenv from "dotenv";
import { LLMServer, Message, OllamaMessage } from "../../type";
import { ChatWithLLMStreamFunction } from "../interface";
import { chatHistoryDir } from "../../utils/dir";
import moment from "moment";

dotenv.config();

// LLM8850 LLM configuration
const llm8850llmEndpoint =
  process.env.LLM8850_LLM_ENDPOINT || "http://localhost:8000";
const llm8850llmTemprature = parseFloat(
  process.env.LLM8850_LLM_TEMPERATURE || "0.7"
);
const llm8850llmTopK = parseInt(process.env.LLM8850_LLM_TOP_K || "40");
const llmServer = (
  process.env.LLM_SERVER || "llm8850"
).toLowerCase() as LLMServer;
const llm8850enableThinking =
  (process.env.LLM8850_ENABLE_THINKING || "false").toLowerCase() === "true";

const chatHistoryFileName = `ollama_chat_history_${moment().format(
  "YYYY-MM-DD_HH-mm-ss"
)}.json`;

const messages: OllamaMessage[] = [
  {
    role: "system",
    content: systemPrompt,
  },
];

let responseInterval: NodeJS.Timeout | null = null;

const resetChatHistory = (): void => {
  axios.post(`${llm8850llmEndpoint}/api/reset`, {
    system_prompt: `${systemPrompt}${
      !llm8850enableThinking ? "/no_think" : ""
    }`,
  });
  if (responseInterval) {
    clearInterval(responseInterval);
    responseInterval = null;
  }
  messages.length = 0;
  messages.push({
    role: "system",
    content: systemPrompt,
  });
};

// Reset chat history on LLM8850 server side
if (llmServer == LLMServer.llm8850) {
  resetChatHistory();
}

const chatWithLLMStream: ChatWithLLMStreamFunction = async (
  inputMessages: Message[] = [],
  partialCallback: (partialAnswer: string) => void,
  endCallback: () => void,
  partialThinkingCallback?: (partialThinking: string) => void,
  invokeFunctionCallback?: (functionName: string, result?: string) => void
): Promise<void> => {
  if (shouldResetChatHistory()) {
    resetChatHistory();
  }
  updateLastMessageTime();
  messages.push(...(inputMessages as OllamaMessage[]));
  let endResolve: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    endResolve = resolve;
  }).finally(() => {
    // save chat history to file
    fs.writeFileSync(
      path.join(chatHistoryDir, chatHistoryFileName),
      JSON.stringify(messages, null, 2)
    );
  });
  let partialAnswer = "";
  let partialThinking = "";
  // const functionCallsPackages: OllamaFunctionCall[][] = [];

  try {
    if (responseInterval) clearInterval(responseInterval);
    await axios.get(`${llm8850llmEndpoint}/api/stop`, {});
    const response = await axios.post(
      `${llm8850llmEndpoint}/api/generate`,
      {
        prompt: inputMessages[0]?.content || "",
        temperature: llm8850llmTemprature,
        "top-k": llm8850llmTopK,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    // Poll for partial response /api/generate_provider
    responseInterval = setInterval(async () => {
      const partialResponse = await axios.get<{
        done: boolean;
        response: string;
      }>(`${llm8850llmEndpoint}/api/generate_provider`);
      if (partialResponse.data.response) {
        const { done, response } = partialResponse.data;
        partialCallback(response);
        partialAnswer += response;
        if (done) {
          if (responseInterval) {
            clearInterval(responseInterval);
            responseInterval = null;
          }
          endResolve();
          endCallback();
        }
      }
    }, 500);
  } catch (error: any) {
    console.error("Error:", error.message);
    endResolve();
    endCallback();
  }

  return promise;
};

export { chatWithLLMStream, resetChatHistory };
