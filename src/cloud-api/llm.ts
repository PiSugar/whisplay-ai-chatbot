import { noop } from "lodash";
import dotenv from "dotenv";
import { LLMServer } from "../type";
import volcengineLLM from "./volcengine/volcengine-llm";
import openaiLLM from "./openai/openai-llm";
import ollamaLLM from "./local/ollama-llm";
import geminiLLM from "./gemini/gemini-llm";
import grokLLM from "./grok/grok-llm";
import llm8850LLM from "./local/llm8850-llm";
import {
  ChatWithLLMStreamFunction,
  ResetChatHistoryFunction,
  SummaryTextWithLLMFunction,
} from "./interface";

dotenv.config();

let chatWithLLMStream: ChatWithLLMStreamFunction = noop as any;
let resetChatHistory: ResetChatHistoryFunction = noop as any;
let summaryTextWithLLM: SummaryTextWithLLMFunction = async (text, _) => text;

export const llmServer: LLMServer = (
  process.env.LLM_SERVER || LLMServer.volcengine
).toLowerCase() as LLMServer;

console.log(`Current LLM Server: ${llmServer}`);

switch (llmServer) {
  case LLMServer.volcengine:
    ({ chatWithLLMStream, resetChatHistory, summaryTextWithLLM } =
      volcengineLLM);
    break;
  case LLMServer.openai:
    ({ chatWithLLMStream, resetChatHistory, summaryTextWithLLM } = openaiLLM);
    break;
  case LLMServer.ollama:
    ({ chatWithLLMStream, resetChatHistory, summaryTextWithLLM } = ollamaLLM);
    break;
  case LLMServer.gemini:
    ({ chatWithLLMStream, resetChatHistory, summaryTextWithLLM } = geminiLLM);
    break;
  case LLMServer.grok:
    ({ chatWithLLMStream, resetChatHistory, summaryTextWithLLM } = grokLLM);
    break;
  case LLMServer.llm8850:
    ({ chatWithLLMStream, resetChatHistory } = llm8850LLM);
    break;
  default:
    console.warn(
      `unknown llm server: ${llmServer}, should be volcengine/openai/gemini/ollama/grok/llm8850`,
    );
    break;
}

export { chatWithLLMStream, resetChatHistory, summaryTextWithLLM };
