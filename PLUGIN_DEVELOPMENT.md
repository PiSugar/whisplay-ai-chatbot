# Whisplay Plugin Development Guide

This guide explains how to develop and install third-party plugins for the Whisplay AI Chatbot. The plugin system supports five types: **ASR (Speech Recognition)**, **LLM (Large Language Model)**, **TTS (Text-to-Speech)**, **IMAGE_GENERATION (Image Generation)**, and **VISION (Image Understanding)**.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Plugin Types](#plugin-types)
- [Quick Start](#quick-start)
- [Plugin Interface Specification](#plugin-interface-specification)
  - [ASR Plugin](#asr-plugin)
  - [LLM Plugin](#llm-plugin)
  - [TTS Plugin](#tts-plugin)
  - [IMAGE_GENERATION Plugin](#image_generation-plugin)
  - [VISION Plugin](#vision-plugin)
- [Installing Third-Party Plugins](#installing-third-party-plugins)
- [Plugin Development Templates](#plugin-development-templates)
- [Type Reference](#type-reference)
- [FAQ](#faq)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                 Plugin Registry                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ ASR      │ │ LLM      │ │ TTS      │  ...   │
│  │ Plugins  │ │ Plugins  │ │ Plugins  │        │
│  └──────────┘ └──────────┘ └──────────┘        │
├─────────────────────────────────────────────────┤
│              Plugin Loader                       │
│  ┌──────────────┐  ┌────────────────────────┐   │
│  │ Built-in     │  │ External               │   │
│  │ Plugins      │  │ plugins/ directory      │   │
│  │              │  │ whisplay-plugin-* npm   │   │
│  └──────────────┘  └────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

The plugin system is automatically initialized at application startup:
1. Registers all built-in plugins (lazy-loaded; unused modules are not loaded)
2. Scans the `plugins/` directory for local third-party plugins
3. Scans `node_modules` for npm packages with the `whisplay-plugin-*` prefix
4. Activates the corresponding plugin based on environment variables (e.g., `ASR_SERVER=openai`)
5. Injects a `PluginContext` (including a snapshot of `process.env`) into each plugin's `activate(ctx)` call

> **Important:** Plugins should read configuration from the injected `ctx.env` rather than accessing `process.env` directly. This ensures proper isolation and testability.

---

## Plugin Types

| Type | Environment Variable | Description |
|------|---------------------|-------------|
| `asr` | `ASR_SERVER` | Speech Recognition: audio file → text |
| `llm` | `LLM_SERVER` | Large Language Model: conversation, summarization |
| `tts` | `TTS_SERVER` | Text-to-Speech: text → audio |
| `image-generation` | `IMAGE_GENERATION_SERVER` | Image Generation: text prompt → image |
| `vision` | `VISION_SERVER` | Image Understanding: image → text description |

---

## Quick Start

### 1. Create a Plugin Directory

```bash
mkdir -p plugins/my-custom-tts
```

### 2. Write the Plugin Entry File

```javascript
// plugins/my-custom-tts/index.js
module.exports = {
  name: "my-custom-tts",          // Unique identifier, used in .env config
  displayName: "My Custom TTS",   // Human-readable name
  version: "1.0.0",               // Semantic version
  type: "tts",                    // Plugin type
  description: "My custom text-to-speech plugin",

  activate(ctx) {
    // Read config from injected ctx.env (NOT process.env)
    const apiKey = ctx.env.MY_TTS_API_KEY;
    return {
      async ttsProcessor(text) {
        // Your TTS implementation
        const buffer = await myTTSApi.synthesize(text, { apiKey });
        const duration = calculateDuration(buffer);
        return { buffer, duration };
      }
    };
  }
};
```

### 3. Configure Environment Variable

```bash
# .env
TTS_SERVER=my-custom-tts
```

### 4. Start the Application

```bash
npm run build && npm start
```

---

## Plugin Interface Specification

Every plugin must export an object that conforms to the following base structure:

```typescript
interface PluginBase {
  name: string;         // Unique identifier, must match the value in .env
  displayName: string;  // Display name
  version: string;      // Semantic version (e.g., "1.0.0")
  type: PluginType;     // "asr" | "llm" | "tts" | "image-generation" | "vision"
  description?: string; // Optional description
  activate(ctx: PluginContext): Provider | Promise<Provider>;  // Activation function, returns a Provider
}

/** Context injected by the host process */
interface PluginContext {
  env: Record<string, string | undefined>;  // Snapshot of environment variables
}
```

The `ctx.env` object is a snapshot of `process.env` at activation time. Plugins should always read configuration from `ctx.env` for proper isolation.

### ASR Plugin

**Purpose:** Convert audio files to text.

```typescript
interface ASRPlugin {
  name: string;
  displayName: string;
  version: string;
  type: "asr";
  activate(ctx: PluginContext): ASRProvider | Promise<ASRProvider>;
}

interface ASRProvider {
  /**
   * Recognize speech from an audio file
   * @param audioPath - Absolute path to the audio file (WAV format)
   * @returns Recognized text, or empty string on failure
   */
  recognizeAudio(audioPath: string): Promise<string>;
}
```

**Full Example:**

```javascript
// plugins/my-asr/index.js
const fs = require("fs");
const axios = require("axios");

module.exports = {
  name: "my-asr",
  displayName: "My ASR Service",
  version: "1.0.0",
  type: "asr",
  description: "Custom ASR using my API",

  activate(ctx) {
    const apiKey = ctx.env.MY_ASR_API_KEY;
    const apiUrl = ctx.env.MY_ASR_API_URL || "https://api.example.com/asr";

    return {
      async recognizeAudio(audioPath) {
        if (!fs.existsSync(audioPath)) {
          console.error("Audio file not found:", audioPath);
          return "";
        }
        try {
          const audioBuffer = fs.readFileSync(audioPath);
          const response = await axios.post(apiUrl, audioBuffer, {
            headers: {
              "Content-Type": "audio/wav",
              "Authorization": `Bearer ${apiKey}`,
            },
          });
          return response.data.text || "";
        } catch (error) {
          console.error("ASR recognition failed:", error.message);
          return "";
        }
      }
    };
  }
};
```

---

### LLM Plugin

**Purpose:** Implement streaming conversation and text summarization.

```typescript
interface LLMPlugin {
  name: string;
  displayName: string;
  version: string;
  type: "llm";
  activate(ctx: PluginContext): LLMProvider | Promise<LLMProvider>;
}

interface LLMProvider {
  /**
   * Streaming chat
   * @param inputMessages - Array of input messages
   * @param partialCallback - Called with each partial text chunk
   * @param endCallBack - Called when generation is complete
   * @param partialThinkingCallback - Thinking process callback (optional, for chain-of-thought models)
   * @param invokeFunctionCallback - Function call callback (optional, for tool invocations)
   */
  chatWithLLMStream: (
    inputMessages: Message[],
    partialCallback: (partialAnswer: string) => void,
    endCallBack: () => void,
    partialThinkingCallback?: (partialThinking: string) => void,
    invokeFunctionCallback?: (functionName: string, result?: string) => void,
  ) => Promise<any>;

  /** Reset conversation history */
  resetChatHistory: () => void;

  /**
   * Text summarization (optional)
   * If not provided, the system will return the original text as-is
   */
  summaryTextWithLLM?: (text: string, promptPrefix: string) => Promise<string>;
}

/** Message type definition */
interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: FunctionCall[];
  tool_call_id?: string;
}
```

**Full Example:**

```javascript
// plugins/my-llm/index.js
module.exports = {
  name: "my-llm",
  displayName: "My LLM Service",
  version: "1.0.0",
  type: "llm",

  activate(ctx) {
    const messages = [
      { role: "system", content: ctx.env.SYSTEM_PROMPT || "You are a helpful assistant." }
    ];

    return {
      async chatWithLLMStream(inputMessages, partialCallback, endCallback) {
        messages.push(...inputMessages);

        try {
          // Your streaming API call
          const stream = await myLLMApi.chat(messages, { stream: true });

          let fullResponse = "";
          for await (const chunk of stream) {
            fullResponse += chunk.text;
            partialCallback(fullResponse);
          }

          messages.push({ role: "assistant", content: fullResponse });
          endCallback();
        } catch (error) {
          console.error("LLM chat failed:", error);
          endCallback();
        }
      },

      resetChatHistory() {
        messages.length = 1; // Keep system prompt
      },

      async summaryTextWithLLM(text, promptPrefix) {
        const response = await myLLMApi.chat([
          { role: "system", content: promptPrefix },
          { role: "user", content: text }
        ]);
        return response.text;
      }
    };
  }
};
```

---

### TTS Plugin

**Purpose:** Convert text to audio.

```typescript
interface TTSPlugin {
  name: string;
  displayName: string;
  version: string;
  type: "tts";
  activate(ctx: PluginContext): TTSProvider | Promise<TTSProvider>;
}

interface TTSProvider {
  /**
   * Text-to-speech synthesis
   * @param text - Text to synthesize
   * @returns TTSResult object
   */
  ttsProcessor(text: string): Promise<TTSResult>;
}

/** TTS return result */
interface TTSResult {
  filePath?: string;   // Audio file path (one of three)
  base64?: string;     // Base64-encoded audio data (one of three)
  buffer?: Buffer;     // Audio Buffer (one of three)
  duration: number;    // Audio duration in milliseconds
}
```

**Full Example:**

```javascript
// plugins/my-tts/index.js
const axios = require("axios");
const mp3Duration = require("mp3-duration");

module.exports = {
  name: "my-tts",
  displayName: "My TTS Service",
  version: "1.0.0",
  type: "tts",

  activate(ctx) {
    const apiKey = ctx.env.MY_TTS_API_KEY;

    return {
      async ttsProcessor(text) {
        try {
          const response = await axios.post(
            "https://api.example.com/tts",
            { text, voice: "default" },
            {
              headers: { Authorization: `Bearer ${apiKey}` },
              responseType: "arraybuffer",
            }
          );

          const buffer = Buffer.from(response.data);
          const duration = await mp3Duration(buffer);

          return {
            buffer,
            duration: duration * 1000, // Convert to milliseconds
          };
        } catch (error) {
          console.error("TTS synthesis failed:", error.message);
          return { duration: 0 };
        }
      }
    };
  }
};
```

---

### IMAGE_GENERATION Plugin

**Purpose:** Provide image generation capabilities through the LLM tool-calling mechanism.

```typescript
interface ImageGenerationPlugin {
  name: string;
  displayName: string;
  version: string;
  type: "image-generation";
  activate(ctx: PluginContext): ImageGenerationProvider | Promise<ImageGenerationProvider>;
}

interface ImageGenerationProvider {
  /**
   * Add image generation tools to the tool list
   * @param tools - LLM tool array; the plugin should push tool definitions into it
   */
  addImageGenerationTools(tools: LLMTool[]): void;
}

/** LLM tool definition */
interface LLMTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type?: string;
      properties?: Record<string, any>;
      required?: string[];
    };
  };
  func: (params: any) => Promise<string>;
}
```

**Full Example:**

```javascript
// plugins/my-image-gen/index.js
const fs = require("fs");
const path = require("path");

module.exports = {
  name: "my-image-gen",
  displayName: "My Image Generator",
  version: "1.0.0",
  type: "image-generation",

  activate(ctx) {
    return {
      addImageGenerationTools(tools) {
        tools.push({
          type: "function",
          function: {
            name: "generateImage",
            description: "Generate an image from a text prompt",
            parameters: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                  description: "The text prompt to generate the image from",
                },
              },
              required: ["prompt"],
            },
          },
          func: async (params) => {
            try {
              const imageBuffer = await myImageApi.generate(params.prompt);
              const fileName = `generated-${Date.now()}.png`;
              const imagePath = path.join(process.cwd(), "img", fileName);
              fs.writeFileSync(imagePath, imageBuffer);
              return "[success]Image generated successfully.";
            } catch (error) {
              return `[error]Image generation failed: ${error.message}`;
            }
          },
        });
      }
    };
  }
};
```

---

### VISION Plugin

**Purpose:** Provide image understanding capabilities through the LLM tool-calling mechanism.

```typescript
interface VisionPlugin {
  name: string;
  displayName: string;
  version: string;
  type: "vision";
  activate(ctx: PluginContext): VisionProvider | Promise<VisionProvider>;
}

interface VisionProvider {
  /**
   * Add vision analysis tools to the tool list
   * @param tools - LLM tool array; the plugin should push tool definitions into it
   */
  addVisionTools(tools: LLMTool[]): void;
}
```

**Full Example:**

```javascript
// plugins/my-vision/index.js
module.exports = {
  name: "my-vision",
  displayName: "My Vision Analyzer",
  version: "1.0.0",
  type: "vision",

  activate(ctx) {
    return {
      addVisionTools(tools) {
        tools.push({
          type: "function",
          function: {
            name: "analyzeImage",
            description: "Analyze and describe the content of an image",
            parameters: {
              type: "object",
              properties: {
                imagePath: {
                  type: "string",
                  description: "Path to the image file",
                },
                question: {
                  type: "string",
                  description: "Question about the image",
                },
              },
              required: ["imagePath"],
            },
          },
          func: async (params) => {
            const description = await myVisionApi.analyze(
              params.imagePath,
              params.question
            );
            return `[response]${description}`;
          },
        });
      }
    };
  }
};
```

---

## Installing Third-Party Plugins

### Option 1: Local Plugin Directory

Place the plugin in the `plugins/` folder at the project root:

```
whisplay-ai-chatbot/
├── plugins/
│   ├── my-custom-asr/
│   │   ├── index.js       # Entry file
│   │   └── package.json   # Optional
│   └── my-custom-tts/
│       ├── index.js
│       └── package.json
├── src/
└── ...
```

Each subdirectory is a plugin. The system automatically loads all subdirectories under `plugins/`.

> **Automatic Dependency Installation:** If a plugin directory contains a `package.json`, the system will automatically run `npm install --production` before loading the plugin (skipped if `node_modules` already exists and is up-to-date). This means plugins can declare their own dependencies in their `package.json` and they will be installed automatically on first launch.

**Example plugin `package.json`:**

```json
{
  "name": "my-custom-tts",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "axios": "^1.6.0",
    "mp3-duration": "^1.1.0"
  }
}
```

### Option 2: npm Packages

Install npm packages with the `whisplay-plugin-` prefix:

```bash
npm install whisplay-plugin-azure-tts
```

The system automatically discovers and loads all packages with the `whisplay-plugin-*` prefix.

### Option 3: Override Built-in Plugins

Third-party plugins can use the same `name` as a built-in plugin to override the built-in implementation:

```javascript
// plugins/better-openai-tts/index.js
module.exports = {
  name: "openai",           // Same name as the built-in OpenAI TTS
  displayName: "Better OpenAI TTS",
  version: "2.0.0",
  type: "tts",
  activate(ctx) {
    // Your improved implementation
    return { ttsProcessor: myBetterTTS };
  }
};
```

> **Note:** Third-party plugins are loaded after built-in plugins, so they will override built-in plugins with the same name.

---

## Plugin Development Templates

### TypeScript Plugin Template

If you prefer developing plugins with TypeScript, you need to compile to JavaScript first:

```
my-plugin/
├── src/
│   └── index.ts
├── dist/
│   └── index.js       ← Compiled output, used as plugin entry
├── package.json
└── tsconfig.json
```

**package.json:**
```json
{
  "name": "whisplay-plugin-my-service",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc"
  }
}
```

**src/index.ts:**
```typescript
import type {
  TTSPlugin,
  TTSProvider,
  TTSResult,
  PluginContext,
} from "whisplay-ai-chatbot/dist/plugin/types";

const plugin: TTSPlugin = {
  name: "my-service",
  displayName: "My Service TTS",
  version: "1.0.0",
  type: "tts",
  description: "Custom TTS implementation",

  activate(ctx: PluginContext): TTSProvider {
    // Read config from ctx.env
    const apiKey = ctx.env.MY_SERVICE_API_KEY;
    return {
      async ttsProcessor(text: string): Promise<TTSResult> {
        // Implementation...
        return { buffer: Buffer.alloc(0), duration: 0 };
      },
    };
  },
};

export default plugin;
```

### Async Initialization

The `activate()` function supports returning a Promise, suitable for scenarios that require async initialization (e.g., connecting to a database, loading a model):

```javascript
module.exports = {
  name: "my-local-asr",
  displayName: "My Local ASR",
  version: "1.0.0",
  type: "asr",

  async activate(ctx) {
    // Read config from ctx.env
    const modelPath = ctx.env.MY_ASR_MODEL_PATH || "./models/asr-model.bin";
    // Asynchronously load the model
    const model = await loadASRModel(modelPath);

    return {
      async recognizeAudio(audioPath) {
        return model.transcribe(audioPath);
      }
    };
  }
};
```

> **Note:** Async `activate()` plugins cannot be activated via `activatePluginSync()`. The system uses synchronous activation by default, so ensure your plugin works in synchronous mode, or coordinate with the project maintainers to use async activation.

---

## Type Reference

All plugin-related TypeScript type definitions are located in `src/plugin/types.ts`. Key types:

| Type | Description |
|------|-------------|
| `PluginType` | `"asr" \| "llm" \| "tts" \| "image-generation" \| "vision"` |
| `PluginContext` | Context object injected into `activate(ctx)` containing `env` |
| `PluginBase` | Base plugin interface (name, displayName, version, type) |
| `ASRPlugin` / `ASRProvider` | ASR plugin and provider interfaces |
| `LLMPlugin` / `LLMProvider` | LLM plugin and provider interfaces |
| `TTSPlugin` / `TTSProvider` | TTS plugin and provider interfaces |
| `ImageGenerationPlugin` / `ImageGenerationProvider` | Image generation plugin and provider interfaces |
| `VisionPlugin` / `VisionProvider` | Vision plugin and provider interfaces |
| `Message` | LLM conversation message type |
| `LLMTool` | LLM tool definition type |
| `TTSResult` | TTS return result type |
| `ToolReturnTag` | Tool return tag enum (Success / Error / Response) |

### Tool Return Tags

In IMAGE_GENERATION and VISION plugins, tool function return values use special prefix tags:

- `[success]` — Operation succeeded
- `[error]` — Operation failed
- `[response]` — Used directly as assistant reply content

---

## FAQ

### Q: What are the requirements for the plugin `name` field?

The `name` is the unique identifier within its plugin type and must exactly match (lowercase) the corresponding environment variable value in the `.env` file. For example, `TTS_SERVER=my-custom-tts` corresponds to `name: "my-custom-tts"`.

### Q: How can I view the list of registered plugins?

You can inspect via the plugin registry API:

```typescript
import { pluginRegistry } from "./plugin";

// List all plugins
console.log(pluginRegistry.listPlugins());

// List plugins of a specific type
console.log(pluginRegistry.getPluginsOfType("tts"));
```

### Q: What is the plugin loading order?

1. Built-in plugins are registered first
2. Plugins in the `plugins/` directory are loaded in alphabetical order by folder name
3. `whisplay-plugin-*` npm packages are loaded in alphabetical order by package name
4. Later-loaded plugins with the same name override earlier ones

### Q: Can plugins access other services?

Yes. During `activate(ctx)`, plugins should read environment variables from `ctx.env` (injected by the host process) and can use `require()` to load any Node.js module. Avoid accessing `process.env` directly — use `ctx.env` instead for proper isolation.

### Q: How do I debug a plugin?

Add logging in `activate(ctx)`, then run the application and check the console:

```javascript
activate(ctx) {
  console.log("[MyPlugin] Initializing...");
  console.log("[MyPlugin] API URL:", ctx.env.MY_PLUGIN_API_URL);
  // ...
}
```
