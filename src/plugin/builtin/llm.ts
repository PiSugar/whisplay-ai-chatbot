import { pluginRegistry } from "../registry";
import { LLMPlugin } from "../types";

export function registerLLMPlugins(): void {
  pluginRegistry.register({
    name: "volcengine",
    displayName: "Volcengine LLM",
    version: "1.0.0",
    type: "llm",
    description: "Volcengine (ByteDance) large language model",
    activate: () => {
      const mod = require("../../cloud-api/volcengine/volcengine-llm").default;
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
      const mod = require("../../cloud-api/openai/openai-llm").default;
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
      const mod = require("../../cloud-api/local/ollama-llm").default;
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
      const mod = require("../../cloud-api/gemini/gemini-llm").default;
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
      const mod = require("../../cloud-api/grok/grok-llm").default;
      return {
        chatWithLLMStream: mod.chatWithLLMStream,
        resetChatHistory: mod.resetChatHistory,
        summaryTextWithLLM: mod.summaryTextWithLLM,
      };
    },
  } as LLMPlugin);

  pluginRegistry.register({
    name: "anthropic",
    displayName: "Anthropic Claude LLM",
    version: "1.0.0",
    type: "llm",
    description: "Anthropic Claude language model",
    activate: () => {
      const mod = require("../../cloud-api/anthropic/anthropic-llm").default;
      return {
        chatWithLLMStream: mod.chatWithLLMStream,
        resetChatHistory: mod.resetChatHistory,
        summaryTextWithLLM: mod.summaryTextWithLLM,
      };
    },
  } as LLMPlugin);

  pluginRegistry.register({
    name: "minimax",
    displayName: "MiniMax LLM",
    version: "1.0.0",
    type: "llm",
    description: "MiniMax large language model",
    activate: () => {
      const mod = require("../../cloud-api/minimax/minimax-llm").default;
      return {
        chatWithLLMStream: mod.chatWithLLMStream,
        resetChatHistory: mod.resetChatHistory,
        summaryTextWithLLM: mod.summaryTextWithLLM,
      };
    },
  } as LLMPlugin);

  pluginRegistry.register({
    name: "kimi",
    displayName: "Kimi LLM",
    version: "1.0.0",
    type: "llm",
    description: "Moonshot AI Kimi large language model",
    activate: () => {
      const mod = require("../../cloud-api/kimi/kimi-llm").default;
      return {
        chatWithLLMStream: mod.chatWithLLMStream,
        resetChatHistory: mod.resetChatHistory,
        summaryTextWithLLM: mod.summaryTextWithLLM,
      };
    },
  } as LLMPlugin);

  pluginRegistry.register({
    name: "qwen",
    displayName: "Qwen LLM",
    version: "1.0.0",
    type: "llm",
    description: "Alibaba Cloud Qwen (通义千问) large language model",
    activate: () => {
      const mod = require("../../cloud-api/qwen/qwen-llm").default;
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
      const mod = require("../../cloud-api/local/llm8850-llm").default;
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
      const mod = require("../../cloud-api/whisplay-im/whisplay-im").default;
      return {
        chatWithLLMStream: mod.chatWithLLMStream,
        resetChatHistory: mod.resetChatHistory,
        summaryTextWithLLM: mod.summaryTextWithLLM,
      };
    },
  } as LLMPlugin);

  pluginRegistry.register({
    name: "perplexity",
    displayName: "Perplexity LLM",
    version: "1.0.0",
    type: "llm",
    description: "Perplexity AI language model",
    activate: () => {
      const mod = require("../../cloud-api/perplexity/perplexity-llm").default;
      return {
        chatWithLLMStream: mod.chatWithLLMStream,
        resetChatHistory: mod.resetChatHistory,
        summaryTextWithLLM: mod.summaryTextWithLLM,
      };
    },
  } as LLMPlugin);

  pluginRegistry.register({
    name: "image-tool-direct",
    displayName: "Image Tool Direct LLM",
    version: "1.0.0",
    type: "llm",
    description: "Directly forwards user text to image-generation tool",
    activate: () => {
      const mod = require("../../cloud-api/local/image-generation-tool-llm").default;
      return {
        chatWithLLMStream: mod.chatWithLLMStream,
        resetChatHistory: mod.resetChatHistory,
        summaryTextWithLLM: mod.summaryTextWithLLM,
      };
    },
  } as LLMPlugin);
}
