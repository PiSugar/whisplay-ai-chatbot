import { pluginRegistry } from "../registry";
import { TTSPlugin } from "../types";

export function registerTTSPlugins(): void {
  pluginRegistry.register({
    name: "volcengine",
    displayName: "Volcengine TTS",
    version: "1.0.0",
    type: "tts",
    audioFormat: "mp3",
    description: "Volcengine (ByteDance) text-to-speech",
    activate: () => {
      const ttsProcessor = require("../../cloud-api/volcengine/volcengine-tts").default;
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
      const ttsProcessor = require("../../cloud-api/openai/openai-tts").default;
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
      const { synthesizeSpeech } = require("../../cloud-api/tencent/tencent-cloud");
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
      const ttsProcessor = require("../../cloud-api/gemini/gemini-tts").default;
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
      const ttsProcessor = require("../../cloud-api/local/piper-tts").default;
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
      const ttsProcessor = require("../../cloud-api/local/piper-http-tts").default;
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
      const ttsProcessor = require("../../cloud-api/local/espeak-ng-tts").default;
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
      const ttsProcessor = require("../../cloud-api/local/llm8850-melotts").default;
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
      const ttsProcessor = require("../../cloud-api/local/supertonic-tts").default;
      return { ttsProcessor };
    },
  } as TTSPlugin);

  pluginRegistry.register({
    name: "picovoice",
    displayName: "Picovoice Orca TTS",
    version: "1.0.0",
    type: "tts",
    audioFormat: "wav",
    description: "Picovoice Orca on-device text-to-speech",
    activate: () => {
      const ttsProcessor = require("../../cloud-api/picovoice/picovoice-tts").default;
      return { ttsProcessor };
    },
  } as TTSPlugin);
}
