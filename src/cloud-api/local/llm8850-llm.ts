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
  process.env.LLM8850_LLM_HOST || "http://localhost:8000";
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
  axios
    .post(`${llm8850llmEndpoint}/api/reset`, {
      system_prompt: `${systemPrompt}${
        !llm8850enableThinking ? "/no_think" : ""
      }`,
    })
    .catch((err) => {
      console.error(
        "Error resetting chat history on LLM8850 server:",
        err.message
      );
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
  // if (shouldResetChatHistory()) {
  //   resetChatHistory();
  // }
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
  let isThinking = false;
  // const functionCallsPackages: OllamaFunctionCall[][] = [];

  try {
    if (responseInterval) {
      clearInterval(responseInterval);
      await axios.get(`${llm8850llmEndpoint}/api/stop`).catch((err) => {
        console.error("Error stopping previous session:", err.message);
      });
    }

    await axios
      .post(`${llm8850llmEndpoint}/api/generate`, {
        prompt: inputMessages[0]?.content || "",
        temperature: llm8850llmTemprature,
        "top-k": llm8850llmTopK,
      })
      .catch((err) => {
        console.error("Error starting generate session:", err.message);
      });

    // Poll for partial response /api/generate_provider
    responseInterval = setInterval(async () => {
      const partialResponse = await axios
        .get<{
          done: boolean;
          response: string;
        }>(`${llm8850llmEndpoint}/api/generate_provider`)
        .catch((err) => {
          console.error("Error getting partial response:", err.message);
          return null;
        });
      if (!partialResponse) {
        return;
      }
      if (partialResponse.data.response) {
        let { done, response } = partialResponse.data;
        if (llm8850enableThinking) {
          // Parse thinking tags
          const thinkStart = response.indexOf("<think>");
          const thinkEnd = response.indexOf("</think>");

          if (thinkStart !== -1 && thinkEnd !== -1) {
            // Both tags present
            const thinkingContent = response.substring(
              thinkStart + 7,
              thinkEnd
            );
            partialThinking += thinkingContent;
            if (partialThinkingCallback) {
              partialThinkingCallback(thinkingContent);
            }
            response =
              response.substring(0, thinkStart) +
              response.substring(thinkEnd + 8);
          } else if (thinkStart !== -1) {
            // Only start tag, everything after is thinking
            const thinkingContent = response.substring(thinkStart + 7);
            partialThinking += thinkingContent;
            if (partialThinkingCallback) {
              partialThinkingCallback(thinkingContent);
            }
            response = response.substring(0, thinkStart);
            isThinking = true;
          } else if (thinkEnd !== -1) {
            // Only end tag, everything before is thinking
            const thinkingContent = response.substring(0, thinkEnd);
            partialThinking += thinkingContent;
            if (partialThinkingCallback) {
              partialThinkingCallback(thinkingContent);
            }
            response = response.substring(thinkEnd + 8);
            isThinking = false;
          } else if (isThinking) {
            // Currently in thinking mode, all content is thinking
            partialThinking += response;
            if (partialThinkingCallback) {
              partialThinkingCallback(response);
            }
            response = "";
          }
        } else {
          response = response.replace("<think>", "");
          response = response.replace("</think>", "");
        }
        if (response) {
          partialCallback(response);
          partialAnswer += response;
        }
        if (done) {
          if (responseInterval) {
            clearInterval(responseInterval);
            responseInterval = null;
          }
          // Check for SetKVCache failed error to reset chat history
          // the context may be full, please reset
          if (partialAnswer.includes("SetKVCache failed")) {
            resetChatHistory();
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
