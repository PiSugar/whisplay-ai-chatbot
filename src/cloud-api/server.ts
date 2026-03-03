// IMPORTANT: Plugin system must be imported FIRST to register all plugins
// before any dependent modules (llm.ts, knowledge.ts) are loaded.
import { pluginRegistry, ASRProvider, TTSProvider } from "../plugin";

import { noop } from "lodash";
import dotenv from "dotenv";
import {
  ASRServer,
  ImageGenerationServer,
  LLMServer,
  TTSServer,
  VisionServer,
} from "../type";
import { chatWithLLMStream, resetChatHistory } from "./llm";
import {
  RecognizeAudioFunction,
  TTSProcessorFunction,
} from "./interface";
import { vectorDB, embedText } from "./knowledge";

dotenv.config();

let recognizeAudio: RecognizeAudioFunction = noop as any;
let ttsProcessor: TTSProcessorFunction = noop as any;

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

// Activate ASR plugin
try {
  const asrProvider = pluginRegistry.activatePluginSync<"asr">("asr", asrServer);
  recognizeAudio = asrProvider.recognizeAudio;
} catch (e: any) {
  console.warn(e.message);
}

// Activate TTS plugin
try {
  const ttsProvider = pluginRegistry.activatePluginSync<"tts">("tts", ttsServer);
  ttsProcessor = ttsProvider.ttsProcessor;
} catch (e: any) {
  console.warn(e.message);
}

export {
  recognizeAudio,
  chatWithLLMStream,
  ttsProcessor,
  resetChatHistory,
  vectorDB,
  embedText,
};
