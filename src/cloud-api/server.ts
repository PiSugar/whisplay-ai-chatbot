import { noop } from "lodash";
import dotenv from "dotenv";
import {
  ASRServer,
  ImageGenerationServer,
  LLMServer,
  TTSServer,
  VisionServer,
} from "../type";
import { recognizeAudio as VolcengineASR } from "./volcengine/volcengine-asr";
import {
  recognizeAudio as TencentASR,
  synthesizeSpeech as TencentTTS,
} from "./tencent/tencent-cloud";
import { recognizeAudio as OpenAIASR } from "./openai/openai-asr";
import { recognizeAudio as GeminiASR } from "./gemini/gemini-asr";
import { recognizeAudio as VoskASR } from "./local/vosk-asr";
import { recognizeAudio as WisperASR } from "./local/whisper-asr";
import {
  chatWithLLMStream as VolcengineLLMStream,
  resetChatHistory as VolcengineResetChatHistory,
} from "./volcengine/volcengine-llm";
import {
  chatWithLLMStream as OpenAILLMStream,
  resetChatHistory as OpenAIResetChatHistory,
} from "./openai/openai-llm";
import {
  chatWithLLMStream as OllamaLLMStream,
  resetChatHistory as OllamaResetChatHistory,
} from "./local/ollama-llm";
import {
  chatWithLLMStream as GeminiLLMStream,
  resetChatHistory as GeminiResetChatHistory,
} from "./gemini/gemini-llm";
import {
  chatWithLLMStream as GrokLLMStream,
  resetChatHistory as GrokResetChatHistory,
} from "./grok/grok-llm";
import VolcengineTTS from "./volcengine/volcengine-tts";
import OpenAITTS from "./openai/openai-tts";
import geminiTTS from "./gemini/gemini-tts";
import {
  ChatWithLLMStreamFunction,
  RecognizeAudioFunction,
  ResetChatHistoryFunction,
  TTSProcessorFunction,
} from "./interface";
import piperTTS from "./local/piper-tts";

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
export const imageGenerationServer: ImageGenerationServer = (
  process.env.IMAGE_GENERATION_SERVER || ""
).toLowerCase() as ImageGenerationServer;
export const visionServer: VisionServer = (
  process.env.VISION_SERVER || ""
).toLowerCase() as VisionServer;

console.log(`Current ASR Server: ${asrServer}`);
console.log(`Current LLM Server: ${llmServer}`);
console.log(`Current TTS Server: ${ttsServer}`);
if (imageGenerationServer)
  console.log(`Current Image Generation Server: ${imageGenerationServer}`);
if (visionServer) console.log(`Current Vision Server: ${visionServer}`);

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
  case ASRServer.whisper:
    recognizeAudio = WisperASR;
    break;
  default:
    console.warn(
      `unknown asr server: ${asrServer}, should be VOLCENGINE/TENCENT/OPENAI/GEMINI/VOSK/WHISPER`
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
  case LLMServer.grok:
    chatWithLLMStream = GrokLLMStream;
    resetChatHistory = GrokResetChatHistory;
    break;
  default:
    console.warn(
      `unknown llm server: ${llmServer}, should be VOLCENGINE/OPENAI/GEMINI/OLLAMA/GROK`
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
