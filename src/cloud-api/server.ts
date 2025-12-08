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
import { recognizeAudio as LLM8850WhisperASR } from "./local/llm8850-whisper";
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
import {
  chatWithLLMStream as LLM8850LLMStream,
  resetChatHistory as LLM8850ResetChatHistory,
} from "./local/llm8850-llm";
import VolcengineTTS from "./volcengine/volcengine-tts";
import OpenAITTS from "./openai/openai-tts";
import geminiTTS from "./gemini/gemini-tts";
import piperTTS from "./local/piper-tts";
import LLM8850MeloTTS from "./local/llm8850-melotts";
import {
  ChatWithLLMStreamFunction,
  RecognizeAudioFunction,
  ResetChatHistoryFunction,
  TTSProcessorFunction,
} from "./interface";

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
  case ASRServer.llm8850whisper:
    recognizeAudio = LLM8850WhisperASR;
    break;
  default:
    console.warn(
      `unknown asr server: ${asrServer}, should be volcengine/tencent/openai/gemini/vosk/whisper/llm8850whisper`
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
  case LLMServer.llm8850:
    chatWithLLMStream = LLM8850LLMStream;
    resetChatHistory = LLM8850ResetChatHistory;
    break;
  default:
    console.warn(
      `unknown llm server: ${llmServer}, should be volcengine/openai/gemini/ollama/grok/llm8850`
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
  case TTSServer.llm8850melotts:
    ttsProcessor = LLM8850MeloTTS;
    break;
  default:
    console.warn(
      `unknown tts server: ${ttsServer}, should be volcengine/tencent/openai/gemini/piper/llm8850melotts`
    );
    break;
}

export { recognizeAudio, chatWithLLMStream, ttsProcessor, resetChatHistory };
