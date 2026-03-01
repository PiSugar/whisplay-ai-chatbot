/**
 * Built-in Plugin Registration
 *
 * Registers all built-in ASR, LLM, TTS, Image Generation, and Vision
 * implementations as plugins. Each plugin's activate() uses lazy require()
 * to avoid loading unnecessary modules.
 */

import { pluginRegistry } from "./registry";
import {
  ASRPlugin,
  LLMPlugin,
  TTSPlugin,
  ImageGenerationPlugin,
  VisionPlugin,
} from "./types";
import { LLMTool } from "../type";

export function registerBuiltinPlugins(): void {
  registerASRPlugins();
  registerLLMPlugins();
  registerTTSPlugins();
  registerImageGenerationPlugins();
  registerVisionPlugins();
}

// ============================================================
//  ASR Plugins
// ============================================================

function registerASRPlugins(): void {
  pluginRegistry.register({
    name: "volcengine",
    displayName: "Volcengine ASR",
    version: "1.0.0",
    type: "asr",
    audioFormat: "mp3",
    description: "Volcengine (ByteDance) speech recognition service",
    activate: () => {
      const { recognizeAudio } = require("../cloud-api/volcengine/volcengine-asr");
      return { recognizeAudio };
    },
  } as ASRPlugin);

  pluginRegistry.register({
    name: "tencent",
    displayName: "Tencent ASR",
    version: "1.0.0",
    type: "asr",
    audioFormat: "mp3",
    description: "Tencent Cloud speech recognition service",
    activate: () => {
      const { recognizeAudio } = require("../cloud-api/tencent/tencent-cloud");
      return { recognizeAudio };
    },
  } as ASRPlugin);

  pluginRegistry.register({
    name: "openai",
    displayName: "OpenAI ASR",
    version: "1.0.0",
    type: "asr",
    audioFormat: "mp3",
    description: "OpenAI Whisper API speech recognition",
    activate: () => {
      const { recognizeAudio } = require("../cloud-api/openai/openai-asr");
      return { recognizeAudio };
    },
  } as ASRPlugin);

  pluginRegistry.register({
    name: "gemini",
    displayName: "Gemini ASR",
    version: "1.0.0",
    type: "asr",
    audioFormat: "mp3",
    description: "Google Gemini speech recognition",
    activate: () => {
      const { recognizeAudio } = require("../cloud-api/gemini/gemini-asr");
      return { recognizeAudio };
    },
  } as ASRPlugin);

  pluginRegistry.register({
    name: "vosk",
    displayName: "Vosk ASR",
    version: "1.0.0",
    type: "asr",
    audioFormat: "wav",
    description: "Vosk offline speech recognition",
    activate: () => {
      const { recognizeAudio } = require("../cloud-api/local/vosk-asr");
      return { recognizeAudio };
    },
  } as ASRPlugin);

  pluginRegistry.register({
    name: "whisper",
    displayName: "Whisper ASR",
    version: "1.0.0",
    type: "asr",
    audioFormat: "wav",
    description: "Local Whisper speech recognition",
    activate: () => {
      const { recognizeAudio } = require("../cloud-api/local/whisper-asr");
      return { recognizeAudio };
    },
  } as ASRPlugin);

  pluginRegistry.register({
    name: "whisper-http",
    displayName: "Whisper HTTP ASR",
    version: "1.0.0",
    type: "asr",
    audioFormat: "wav",
    description: "Whisper HTTP API speech recognition",
    activate: () => {
      const { recognizeAudio } = require("../cloud-api/local/whisper-http-asr");
      return { recognizeAudio };
    },
  } as ASRPlugin);

  pluginRegistry.register({
    name: "llm8850whisper",
    displayName: "LLM8850 Whisper ASR",
    version: "1.0.0",
    type: "asr",
    audioFormat: "wav",
    description: "LLM8850 Whisper speech recognition",
    activate: () => {
      const { recognizeAudio } = require("../cloud-api/local/llm8850-whisper");
      return { recognizeAudio };
    },
  } as ASRPlugin);

  pluginRegistry.register({
    name: "faster-whisper",
    displayName: "Faster Whisper ASR",
    version: "1.0.0",
    type: "asr",
    audioFormat: "wav",
    description: "Faster Whisper optimized speech recognition",
    activate: () => {
      const { recognizeAudio } = require("../cloud-api/local/faster-whisper-asr");
      return { recognizeAudio };
    },
  } as ASRPlugin);
}

// ============================================================
//  LLM Plugins
// ============================================================

function registerLLMPlugins(): void {
  pluginRegistry.register({
    name: "volcengine",
    displayName: "Volcengine LLM",
    version: "1.0.0",
    type: "llm",
    description: "Volcengine (ByteDance) large language model",
    activate: () => {
      const mod = require("../cloud-api/volcengine/volcengine-llm").default;
      return {
        chatWithLLMStream: mod.chatWithLLMStream,
        resetChatHistory: mod.resetChatHistory,
        summaryTextWithLLM: mod.summaryTextWithLLM,
      };
    },
  } as LLMPlugin);

  pluginRegistry.register({
    name: "openai",
    displayName: "OpenAI LLM",
    version: "1.0.0",
    type: "llm",
    description: "OpenAI GPT language model",
    activate: () => {
      const mod = require("../cloud-api/openai/openai-llm").default;
      return {
        chatWithLLMStream: mod.chatWithLLMStream,
        resetChatHistory: mod.resetChatHistory,
        summaryTextWithLLM: mod.summaryTextWithLLM,
      };
    },
  } as LLMPlugin);

  pluginRegistry.register({
    name: "ollama",
    displayName: "Ollama LLM",
    version: "1.0.0",
    type: "llm",
    description: "Ollama local large language model",
    activate: () => {
      const mod = require("../cloud-api/local/ollama-llm").default;
      return {
        chatWithLLMStream: mod.chatWithLLMStream,
        resetChatHistory: mod.resetChatHistory,
        summaryTextWithLLM: mod.summaryTextWithLLM,
      };
    },
  } as LLMPlugin);

  pluginRegistry.register({
    name: "gemini",
    displayName: "Gemini LLM",
    version: "1.0.0",
    type: "llm",
    description: "Google Gemini language model",
    activate: () => {
      const mod = require("../cloud-api/gemini/gemini-llm").default;
      return {
        chatWithLLMStream: mod.chatWithLLMStream,
        resetChatHistory: mod.resetChatHistory,
        summaryTextWithLLM: mod.summaryTextWithLLM,
      };
    },
  } as LLMPlugin);

  pluginRegistry.register({
    name: "grok",
    displayName: "Grok LLM",
    version: "1.0.0",
    type: "llm",
    description: "xAI Grok language model",
    activate: () => {
      const mod = require("../cloud-api/grok/grok-llm").default;
      return {
        chatWithLLMStream: mod.chatWithLLMStream,
        resetChatHistory: mod.resetChatHistory,
        summaryTextWithLLM: mod.summaryTextWithLLM,
      };
    },
  } as LLMPlugin);

  pluginRegistry.register({
    name: "llm8850",
    displayName: "LLM8850 LLM",
    version: "1.0.0",
    type: "llm",
    description: "LLM8850 local language model",
    activate: () => {
      const mod = require("../cloud-api/local/llm8850-llm").default;
      return {
        chatWithLLMStream: mod.chatWithLLMStream,
        resetChatHistory: mod.resetChatHistory,
      };
    },
  } as LLMPlugin);

  pluginRegistry.register({
    name: "whisplay-im",
    displayName: "Whisplay IM",
    version: "1.0.0",
    type: "llm",
    description: "Whisplay IM bridge mode",
    activate: () => {
      const mod = require("../cloud-api/whisplay-im/whisplay-im").default;
      return {
        chatWithLLMStream: mod.chatWithLLMStream,
        resetChatHistory: mod.resetChatHistory,
        summaryTextWithLLM: mod.summaryTextWithLLM,
      };
    },
  } as LLMPlugin);
}

// ============================================================
//  TTS Plugins
// ============================================================

function registerTTSPlugins(): void {
  pluginRegistry.register({
    name: "volcengine",
    displayName: "Volcengine TTS",
    version: "1.0.0",
    type: "tts",
    audioFormat: "mp3",
    description: "Volcengine (ByteDance) text-to-speech",
    activate: () => {
      const ttsProcessor = require("../cloud-api/volcengine/volcengine-tts").default;
      return { ttsProcessor };
    },
  } as TTSPlugin);

  pluginRegistry.register({
    name: "openai",
    displayName: "OpenAI TTS",
    version: "1.0.0",
    type: "tts",
    audioFormat: "mp3",
    description: "OpenAI text-to-speech",
    activate: () => {
      const ttsProcessor = require("../cloud-api/openai/openai-tts").default;
      return { ttsProcessor };
    },
  } as TTSPlugin);

  pluginRegistry.register({
    name: "tencent",
    displayName: "Tencent TTS",
    version: "1.0.0",
    type: "tts",
    audioFormat: "mp3",
    description: "Tencent Cloud text-to-speech",
    activate: () => {
      const { synthesizeSpeech } = require("../cloud-api/tencent/tencent-cloud");
      return { ttsProcessor: synthesizeSpeech };
    },
  } as TTSPlugin);

  pluginRegistry.register({
    name: "gemini",
    displayName: "Gemini TTS",
    version: "1.0.0",
    type: "tts",
    audioFormat: "wav",
    description: "Google Gemini text-to-speech",
    activate: () => {
      const ttsProcessor = require("../cloud-api/gemini/gemini-tts").default;
      return { ttsProcessor };
    },
  } as TTSPlugin);

  pluginRegistry.register({
    name: "piper",
    displayName: "Piper TTS",
    version: "1.0.0",
    type: "tts",
    audioFormat: "wav",
    description: "Piper local text-to-speech",
    activate: () => {
      const ttsProcessor = require("../cloud-api/local/piper-tts").default;
      return { ttsProcessor };
    },
  } as TTSPlugin);

  pluginRegistry.register({
    name: "piper-http",
    displayName: "Piper HTTP TTS",
    version: "1.0.0",
    type: "tts",
    audioFormat: "mp3",
    description: "Piper HTTP API text-to-speech",
    activate: () => {
      const ttsProcessor = require("../cloud-api/local/piper-http-tts").default;
      return { ttsProcessor };
    },
  } as TTSPlugin);

  pluginRegistry.register({
    name: "espeak-ng",
    displayName: "eSpeak NG TTS",
    version: "1.0.0",
    type: "tts",
    audioFormat: "mp3",
    description: "eSpeak NG offline text-to-speech",
    activate: () => {
      const ttsProcessor = require("../cloud-api/local/espeak-ng-tts").default;
      return { ttsProcessor };
    },
  } as TTSPlugin);

  pluginRegistry.register({
    name: "llm8850melotts",
    displayName: "LLM8850 MeloTTS",
    version: "1.0.0",
    type: "tts",
    audioFormat: "mp3",
    description: "LLM8850 MeloTTS text-to-speech",
    activate: () => {
      const ttsProcessor = require("../cloud-api/local/llm8850-melotts").default;
      return { ttsProcessor };
    },
  } as TTSPlugin);

  pluginRegistry.register({
    name: "supertonic",
    displayName: "Supertonic TTS",
    version: "1.0.0",
    type: "tts",
    audioFormat: "mp3",
    description: "Supertonic text-to-speech",
    activate: () => {
      const ttsProcessor = require("../cloud-api/local/supertonic-tts").default;
      return { ttsProcessor };
    },
  } as TTSPlugin);
}

// ============================================================
//  Image Generation Plugins
// ============================================================

function registerImageGenerationPlugins(): void {
  pluginRegistry.register({
    name: "gemini",
    displayName: "Gemini Image Generation",
    version: "1.0.0",
    type: "image-generation",
    description: "Google Gemini image generation",
    activate: () => {
      const { addGeminiGenerationTool } = require("../cloud-api/gemini/gemini-image-generation");
      return {
        addImageGenerationTools: (tools: LLMTool[]) =>
          addGeminiGenerationTool(tools),
      };
    },
  } as ImageGenerationPlugin);

  pluginRegistry.register({
    name: "openai",
    displayName: "OpenAI Image Generation",
    version: "1.0.0",
    type: "image-generation",
    description: "OpenAI DALL-E image generation",
    activate: () => {
      const { addOpenaiGenerationTool } = require("../cloud-api/openai/openai-image-generation");
      return {
        addImageGenerationTools: (tools: LLMTool[]) =>
          addOpenaiGenerationTool(tools),
      };
    },
  } as ImageGenerationPlugin);

  pluginRegistry.register({
    name: "volcengine",
    displayName: "Volcengine Image Generation",
    version: "1.0.0",
    type: "image-generation",
    description: "Volcengine image generation",
    activate: () => {
      const { addVolcengineGenerationTool } = require("../cloud-api/volcengine/volcengine-image-generation");
      return {
        addImageGenerationTools: (tools: LLMTool[]) =>
          addVolcengineGenerationTool(tools),
      };
    },
  } as ImageGenerationPlugin);
}

// ============================================================
//  Vision Plugins
// ============================================================

function registerVisionPlugins(): void {
  pluginRegistry.register({
    name: "ollama",
    displayName: "Ollama Vision",
    version: "1.0.0",
    type: "vision",
    description: "Ollama local vision model",
    activate: () => {
      const { addOllamaVisionTool } = require("../cloud-api/local/ollama-vision");
      return {
        addVisionTools: (tools: LLMTool[]) => addOllamaVisionTool(tools),
      };
    },
  } as VisionPlugin);

  pluginRegistry.register({
    name: "openai",
    displayName: "OpenAI Vision",
    version: "1.0.0",
    type: "vision",
    description: "OpenAI vision model",
    activate: () => {
      const { addOpenaiVisionTool } = require("../cloud-api/openai/openai-vision");
      return {
        addVisionTools: (tools: LLMTool[]) => addOpenaiVisionTool(tools),
      };
    },
  } as VisionPlugin);

  pluginRegistry.register({
    name: "gemini",
    displayName: "Gemini Vision",
    version: "1.0.0",
    type: "vision",
    description: "Google Gemini vision model",
    activate: () => {
      const { addGeminiVisionTool } = require("../cloud-api/gemini/gemini-vision");
      return {
        addVisionTools: (tools: LLMTool[]) => addGeminiVisionTool(tools),
      };
    },
  } as VisionPlugin);

  pluginRegistry.register({
    name: "volcengine",
    displayName: "Volcengine Vision",
    version: "1.0.0",
    type: "vision",
    description: "Volcengine vision model",
    activate: () => {
      const { addVolcengineVisionTool } = require("../cloud-api/volcengine/volcengine-vision");
      return {
        addVisionTools: (tools: LLMTool[]) => addVolcengineVisionTool(tools),
      };
    },
  } as VisionPlugin);
}
