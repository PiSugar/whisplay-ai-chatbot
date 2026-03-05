/**
 * Whisplay Plugin System - Type Definitions
 *
 * This module defines the interfaces for all plugin types.
 * Third-party plugin developers should implement these interfaces.
 */

import { Message, LLMTool, TTSResult } from "../type";

// ========== Plugin Categories ==========

export type PluginType = "asr" | "llm" | "tts" | "image-generation" | "vision" | "llm-tools";
export type AudioFormat = "wav" | "mp3";

// ========== Provider Interfaces ==========

/** ASR (Automatic Speech Recognition) provider */
export interface ASRProvider {
  recognizeAudio(audioPath: string): Promise<string>;
}

/** LLM (Large Language Model) provider */
export interface LLMProvider {
  chatWithLLMStream: (
    inputMessages: Message[],
    partialCallback: (partialAnswer: string) => void,
    endCallBack: () => void,
    partialThinkingCallback?: (partialThinking: string) => void,
    invokeFunctionCallback?: (functionName: string, result?: string) => void,
  ) => Promise<any>;
  resetChatHistory: () => void;
  summaryTextWithLLM?: (text: string, promptPrefix: string) => Promise<string>;
}

/** TTS (Text-to-Speech) provider */
export interface TTSProvider {
  ttsProcessor(text: string): Promise<TTSResult>;
}

/** Image Generation provider */
export interface ImageGenerationProvider {
  addImageGenerationTools(tools: LLMTool[]): void;
}

/** Vision (image understanding) provider */
export interface VisionProvider {
  addVisionTools(tools: LLMTool[]): void;
}

/** LLM Tools provider – contributes function-calling tools to the LLM */
export interface LLMToolsProvider {
  /** Return the tool definitions this plugin contributes */
  getTools(): LLMTool[];
}

// ========== Provider Type Map ==========

export interface ProviderTypeMap {
  asr: ASRProvider;
  llm: LLMProvider;
  tts: TTSProvider;
  "image-generation": ImageGenerationProvider;
  vision: VisionProvider;
  "llm-tools": LLMToolsProvider;
}

// ========== Plugin Context ==========

/**
 * Context object injected into plugins by the host process.
 * Plugins should read configuration from ctx.env instead of
 * accessing process.env directly.
 */
export interface PluginContext {
  /**
   * Merged environment variables: global process.env overridden by
   * the plugin's own `.env` file (if present). Plugins should read
   * all configuration from here.
   */
  env: Record<string, string | undefined>;
  /**
   * Environment variables loaded exclusively from the plugin's own `.env`
   * file. Empty object if the plugin has no `.env`. These variables are
   * scoped to this plugin and never pollute process.env or other plugins.
   */
  pluginEnv: Record<string, string>;
  /** Host-managed image output directory for image generation plugins */
  imageDir: string;
  /** Host-managed TTS working/output directory for TTS plugins */
  ttsDir: string;
}

// ========== Plugin Base ==========

export interface PluginBase {
  /** Unique plugin identifier within its type (e.g., "openai") */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Semantic version string (e.g., "1.0.0") */
  version: string;
  /** Plugin category */
  type: PluginType;
  /** Optional description of the plugin */
  description?: string;
}

// ========== Typed Plugin Interfaces ==========

export interface ASRPlugin extends PluginBase {
  type: "asr";
  /** Audio format used by this plugin (ASR: input recording format) */
  audioFormat?: AudioFormat;
  activate(ctx: PluginContext): ASRProvider | Promise<ASRProvider>;
}

export interface LLMPlugin extends PluginBase {
  type: "llm";
  activate(ctx: PluginContext): LLMProvider | Promise<LLMProvider>;
}

export interface TTSPlugin extends PluginBase {
  type: "tts";
  /** Audio format used by this plugin (TTS: playback decoding format for base64/buffer) */
  audioFormat?: AudioFormat;
  activate(ctx: PluginContext): TTSProvider | Promise<TTSProvider>;
}

export interface ImageGenerationPlugin extends PluginBase {
  type: "image-generation";
  activate(ctx: PluginContext): ImageGenerationProvider | Promise<ImageGenerationProvider>;
}

export interface VisionPlugin extends PluginBase {
  type: "vision";
  activate(ctx: PluginContext): VisionProvider | Promise<VisionProvider>;
}

export interface LLMToolsPlugin extends PluginBase {
  type: "llm-tools";
  activate(ctx: PluginContext): LLMToolsProvider | Promise<LLMToolsProvider>;
}

export type Plugin =
  | ASRPlugin
  | LLMPlugin
  | TTSPlugin
  | ImageGenerationPlugin
  | VisionPlugin
  | LLMToolsPlugin;
