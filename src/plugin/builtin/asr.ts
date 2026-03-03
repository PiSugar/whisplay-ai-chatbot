import { pluginRegistry } from "../registry";
import { ASRPlugin } from "../types";

export function registerASRPlugins(): void {
  pluginRegistry.register({
    name: "volcengine",
    displayName: "Volcengine ASR",
    version: "1.0.0",
    type: "asr",
    audioFormat: "mp3",
    description: "Volcengine (ByteDance) speech recognition service",
    activate: () => {
      const { recognizeAudio } = require("../../cloud-api/volcengine/volcengine-asr");
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
      const { recognizeAudio } = require("../../cloud-api/tencent/tencent-cloud");
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
      const { recognizeAudio } = require("../../cloud-api/openai/openai-asr");
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
      const { recognizeAudio } = require("../../cloud-api/gemini/gemini-asr");
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
      const { recognizeAudio } = require("../../cloud-api/local/vosk-asr");
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
      const { recognizeAudio } = require("../../cloud-api/local/whisper-asr");
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
      const { recognizeAudio } = require("../../cloud-api/local/whisper-http-asr");
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
      const { recognizeAudio } = require("../../cloud-api/local/llm8850-whisper");
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
      const { recognizeAudio } = require("../../cloud-api/local/faster-whisper-asr");
      return { recognizeAudio };
    },
  } as ASRPlugin);

  pluginRegistry.register({
    name: "hailowhisper",
    displayName: "Hailo Whisper ASR",
    version: "1.0.0",
    type: "asr",
    audioFormat: "wav",
    description: "Hailo-10H NPU-accelerated Whisper speech recognition (AI Hat+ 2)",
    activate: () => {
      const { recognizeAudio } = require("../../cloud-api/local/hailo-whisper-asr");
      return { recognizeAudio };
    },
  } as ASRPlugin);

  pluginRegistry.register({
    name: "picovoice",
    displayName: "Picovoice Leopard ASR",
    version: "1.0.0",
    type: "asr",
    audioFormat: "wav",
    description: "Picovoice Leopard on-device speech recognition",
    activate: () => {
      const { recognizeAudio } = require("../../cloud-api/picovoice/picovoice-asr");
      return { recognizeAudio };
    },
  } as ASRPlugin);
}
