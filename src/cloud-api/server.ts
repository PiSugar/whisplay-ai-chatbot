import { noop } from "lodash";
import dotenv from "dotenv";
import { ASRServer, LLMServer, TTSServer } from "../type";
import { recognizeAudio as VolcengineASR } from "./volcengine-asr";
import {
  recognizeAudio as TencentASR,
  synthesizeSpeech as TencentTTS,
} from "./tencent-cloud";
import { recognizeAudio as OpenAIASR } from "./openai-asr";
import { recognizeAudio as GeminiASR } from "./gemini-asr";
import { recognizeAudio as VoskASR } from "./vosk-asr";
import {
  chatWithLLMStream as VolcengineLLMStream,
  resetChatHistory as VolcengineResetChatHistory,
} from "./volcengine-llm";
import {
  chatWithLLMStream as OpenAILLMStream,
  resetChatHistory as OpenAIResetChatHistory,
} from "./openai-llm";
import {
  chatWithLLMStream as OllamaLLMStream,
  resetChatHistory as OllamaResetChatHistory,
} from "./ollama-llm";
import {
  chatWithLLMStream as GeminiLLMStream,
  resetChatHistory as GeminiResetChatHistory,
} from "./gemini-llm";
import VolcengineTTS from "./volcengine-tts";
import OpenAITTS from "./openai-tts";
import geminiTTS from "./gemini-tts";
import {
  ChatWithLLMStreamFunction,
  RecognizeAudioFunction,
  ResetChatHistoryFunction,
  TTSProcessorFunction,
} from "./interface";
import piperTTS from "./piper-tts";

dotenv.config();

let recognizeAudio: RecognizeAudioFunction = noop as any;
let chatWithLLMStream: ChatWithLLMStreamFunction = noop as any;
let ttsProcessor: TTSProcessorFunction = noop as any;
let resetChatHistory: ResetChatHistoryFunction = noop as any;

export const asrServer: ASRServer = (
  process.env.ASR_SERVER || ASRServer.tencent
).toLowerCase() as ASRServer;
export const llmServer: LLMServer = (
  process.env.LLM_SERVER || LLMServer.volcengine
).toLowerCase() as LLMServer;
export const ttsServer: TTSServer = (
  process.env.TTS_SERVER || TTSServer.volcengine
).toLowerCase() as TTSServer;

switch (asrServer) {
  case ASRServer.volcengine:
    recognizeAudio = VolcengineASR;
    break;
  case ASRServer.tencent:
    recognizeAudio = TencentASR;
    break;
  case ASRServer.openai:
    recognizeAudio = OpenAIASR;
    break;
  case ASRServer.gemini:
    recognizeAudio = GeminiASR;
    break;
  case ASRServer.vosk:
    recognizeAudio = VoskASR;
    break;
  default:
    console.warn(
      `unknown asr server: ${asrServer}, should be VOLCENGINE/TENCENT/OPENAI/GEMINI`
    );
    break;
}

switch (llmServer) {
  case LLMServer.volcengine:
    chatWithLLMStream = VolcengineLLMStream;
    resetChatHistory = VolcengineResetChatHistory;
    break;
  case LLMServer.openai:
    chatWithLLMStream = OpenAILLMStream;
    resetChatHistory = OpenAIResetChatHistory;
    break;
  case LLMServer.ollama:
    chatWithLLMStream = OllamaLLMStream;
    resetChatHistory = OllamaResetChatHistory;
    break;
  case LLMServer.gemini:
    chatWithLLMStream = GeminiLLMStream;
    resetChatHistory = GeminiResetChatHistory;
    break;
  default:
    console.warn(
      `unknown llm server: ${llmServer}, should be VOLCENGINE/OPENAI/GEMINI/OLLAMA`
    );
    break;
}

switch (ttsServer) {
  case TTSServer.volcengine:
    ttsProcessor = VolcengineTTS;
    break;
  case TTSServer.openai:
    ttsProcessor = OpenAITTS;
    break;
  case TTSServer.tencent:
    ttsProcessor = TencentTTS;
    break;
  case TTSServer.gemini:
    ttsProcessor = geminiTTS;
    break;
  case TTSServer.piper:
    ttsProcessor = piperTTS;
    break;
  default:
    console.warn(
      `unknown tts server: ${ttsServer}, should be VOLCENGINE/TENCENT/OPENAI/GEMINI/PIPER`
    );
    break;
}

export { recognizeAudio, chatWithLLMStream, ttsProcessor, resetChatHistory };
