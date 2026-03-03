#!/usr/bin/env bash
# ============================================================
# cli/plugin-create.sh — Interactive plugin scaffolding
# ============================================================

# ── Main create flow ─────────────────────────────────────────

plugin_create() {
  ensure_plugins_dir

  local plugin_name=""
  local plugin_type=""
  local use_ts=""

  echo ""
  _bold "🔧 Create a new Whisplay plugin"
  echo ""

  # Plugin name
  while [ -z "$plugin_name" ]; do
    printf "  Plugin name (e.g. my-custom-tts): "
    read -r plugin_name
    plugin_name="$(echo "$plugin_name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')"
    if [ -z "$plugin_name" ]; then
      _red "  Plugin name cannot be empty."
    fi
    if [ -d "${PLUGINS_DIR}/${plugin_name}" ]; then
      _red "  Plugin '${plugin_name}' already exists in ${PLUGINS_DIR}"
      plugin_name=""
    fi
  done

  # Plugin type
  echo ""
  echo "  Plugin types:"
  echo "    1) asr              — Speech Recognition"
  echo "    2) llm              — Large Language Model"
  echo "    3) tts              — Text-to-Speech"
  echo "    4) image-generation — Image Generation"
  echo "    5) vision           — Image Understanding"
  echo "    6) llm-tools        — LLM Function-Calling Tools"
  echo ""
  while [ -z "$plugin_type" ]; do
    printf "  Select type [1-6]: "
    read -r type_choice
    case "$type_choice" in
      1) plugin_type="asr" ;;
      2) plugin_type="llm" ;;
      3) plugin_type="tts" ;;
      4) plugin_type="image-generation" ;;
      5) plugin_type="vision" ;;
      6) plugin_type="llm-tools" ;;
      *) _red "  Invalid choice. Please enter 1-6." ;;
    esac
  done

  # Language
  echo ""
  printf "  Use TypeScript? [Y/n]: "
  read -r use_ts
  use_ts="${use_ts:-Y}"

  local dest="${PLUGINS_DIR}/${plugin_name}"
  mkdir -p "$dest"

  local display_name
  display_name="$(echo "$plugin_name" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1')"

  # Generate files
  if [[ "$use_ts" =~ ^[Yy] ]]; then
    _scaffold_typescript "$dest" "$plugin_name" "$plugin_type" "$display_name"
  else
    _scaffold_javascript "$dest" "$plugin_name" "$plugin_type" "$display_name"
  fi

  _scaffold_env "$dest" "$plugin_name" "$plugin_type"
  _scaffold_gitignore "$dest"

  echo ""
  _green "✅ Plugin '${plugin_name}' created at ${dest}"
  echo ""
  _bold "Next steps:"
  if [[ "$use_ts" =~ ^[Yy] ]]; then
    echo "  1. cd ${dest}"
    echo "  2. npm install"
    echo "  3. Edit src/index.ts to implement your plugin"
    echo "  4. npm run build"
  else
    echo "  1. cd ${dest}"
    echo "  2. Edit index.js to implement your plugin"
  fi
  echo "  5. Configure your .env file with API keys (if needed)"
  echo "  6. Restart the chatbot"
  echo ""
}

# ── Scaffold: .gitignore ─────────────────────────────────────

_scaffold_gitignore() {
  cat > "$1/.gitignore" << 'GITIGNORE'
node_modules/
dist/
.env
GITIGNORE
}

# ── Scaffold: .env.template ─────────────────────────────────

_scaffold_env() {
  local dest="$1" name="$2" ptype="$3"
  local env_prefix
  env_prefix="$(echo "${name}" | tr '[:lower:]-' '[:upper:]_')"

  cat > "${dest}/.env.template" << ENVEOF
# ${name} plugin configuration
# Copy this file to .env and fill in your values.

# API Key (if applicable)
${env_prefix}_API_KEY=

# Endpoint URL (if applicable)
# ${env_prefix}_ENDPOINT=
ENVEOF
}

# ── Scaffold: TypeScript project ─────────────────────────────

_scaffold_typescript() {
  local dest="$1" name="$2" ptype="$3" display_name="$4"
  mkdir -p "${dest}/src"

  cat > "${dest}/package.json" << PKGJSON
{
  "name": "${name}",
  "version": "1.0.0",
  "description": "${display_name} plugin for Whisplay AI Chatbot",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.8.0"
  }
}
PKGJSON

  cat > "${dest}/tsconfig.json" << 'TSCONF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
TSCONF

  _generate_ts_entry "$dest" "$name" "$ptype" "$display_name"
}

# ── Scaffold: JavaScript project ─────────────────────────────

_scaffold_javascript() {
  local dest="$1" name="$2" ptype="$3" display_name="$4"

  cat > "${dest}/package.json" << PKGJSON
{
  "name": "${name}",
  "version": "1.0.0",
  "description": "${display_name} plugin for Whisplay AI Chatbot",
  "main": "index.js",
  "dependencies": {}
}
PKGJSON

  _generate_js_entry "$dest" "$name" "$ptype" "$display_name"
}

# ── TypeScript entry templates ───────────────────────────────

_generate_ts_entry() {
  local dest="$1" name="$2" ptype="$3" display_name="$4"
  local file="${dest}/src/index.ts"

  case "$ptype" in
    asr)
      cat > "$file" << TSEOF
import type {
  ASRPlugin,
  ASRProvider,
  PluginContext,
} from "whisplay-ai-chatbot/dist/plugin/types";

const plugin: ASRPlugin = {
  name: "${name}",
  displayName: "${display_name}",
  version: "1.0.0",
  type: "asr",
  audioFormat: "wav",
  description: "${display_name} ASR plugin",

  activate(ctx: PluginContext): ASRProvider {
    const apiKey = ctx.pluginEnv.${name//[-]/_}_API_KEY;

    return {
      async recognizeAudio(audioPath: string): Promise<string> {
        // TODO: Implement speech recognition
        // audioPath is the path to the recorded audio file
        throw new Error("Not implemented");
      },
    };
  },
};

export default plugin;
TSEOF
      ;;
    llm)
      cat > "$file" << TSEOF
import type {
  LLMPlugin,
  LLMProvider,
  PluginContext,
} from "whisplay-ai-chatbot/dist/plugin/types";
import type { Message } from "whisplay-ai-chatbot/dist/type";

const plugin: LLMPlugin = {
  name: "${name}",
  displayName: "${display_name}",
  version: "1.0.0",
  type: "llm",
  description: "${display_name} LLM plugin",

  activate(ctx: PluginContext): LLMProvider {
    const apiKey = ctx.pluginEnv.${name//[-]/_}_API_KEY;
    let chatHistory: Message[] = [];

    return {
      async chatWithLLMStream(
        inputMessages: Message[],
        partialCallback: (text: string) => void,
        endCallBack: () => void,
        partialThinkingCallback?: (text: string) => void,
        invokeFunctionCallback?: (name: string, result?: string) => void,
      ) {
        // TODO: Implement streaming LLM chat
        partialCallback("Hello from ${display_name}!");
        endCallBack();
      },

      resetChatHistory() {
        chatHistory = [];
      },
    };
  },
};

export default plugin;
TSEOF
      ;;
    tts)
      cat > "$file" << TSEOF
import type {
  TTSPlugin,
  TTSProvider,
  PluginContext,
} from "whisplay-ai-chatbot/dist/plugin/types";
import type { TTSResult } from "whisplay-ai-chatbot/dist/type";

const plugin: TTSPlugin = {
  name: "${name}",
  displayName: "${display_name}",
  version: "1.0.0",
  type: "tts",
  audioFormat: "mp3",
  description: "${display_name} TTS plugin",

  activate(ctx: PluginContext): TTSProvider {
    const apiKey = ctx.pluginEnv.${name//[-]/_}_API_KEY;

    return {
      async ttsProcessor(text: string): Promise<TTSResult> {
        // TODO: Implement text-to-speech
        // Return { filePath, duration } or { buffer, duration }
        throw new Error("Not implemented");
      },
    };
  },
};

export default plugin;
TSEOF
      ;;
    image-generation)
      cat > "$file" << TSEOF
import type {
  ImageGenerationPlugin,
  ImageGenerationProvider,
  PluginContext,
} from "whisplay-ai-chatbot/dist/plugin/types";
import type { LLMTool } from "whisplay-ai-chatbot/dist/type";

const plugin: ImageGenerationPlugin = {
  name: "${name}",
  displayName: "${display_name}",
  version: "1.0.0",
  type: "image-generation",
  description: "${display_name} image generation plugin",

  activate(ctx: PluginContext): ImageGenerationProvider {
    const apiKey = ctx.pluginEnv.${name//[-]/_}_API_KEY;

    return {
      addImageGenerationTools(tools: LLMTool[]) {
        tools.push({
          type: "function",
          function: {
            name: "generateImage",
            description: "Generate an image from a text prompt",
            parameters: {
              type: "object",
              properties: {
                prompt: { type: "string", description: "Image description" },
              },
              required: ["prompt"],
            },
          },
        });
      },
    };
  },
};

export default plugin;
TSEOF
      ;;
    vision)
      cat > "$file" << TSEOF
import type {
  VisionPlugin,
  VisionProvider,
  PluginContext,
} from "whisplay-ai-chatbot/dist/plugin/types";
import type { LLMTool } from "whisplay-ai-chatbot/dist/type";

const plugin: VisionPlugin = {
  name: "${name}",
  displayName: "${display_name}",
  version: "1.0.0",
  type: "vision",
  description: "${display_name} vision plugin",

  activate(ctx: PluginContext): VisionProvider {
    const apiKey = ctx.pluginEnv.${name//[-]/_}_API_KEY;

    return {
      addVisionTools(tools: LLMTool[]) {
        tools.push({
          type: "function",
          function: {
            name: "analyzeImage",
            description: "Analyze an image and describe its content",
            parameters: {
              type: "object",
              properties: {
                imagePath: { type: "string", description: "Path to the image" },
              },
              required: ["imagePath"],
            },
          },
        });
      },
    };
  },
};

export default plugin;
TSEOF
      ;;
    llm-tools)
      cat > "$file" << TSEOF
import type {
  LLMToolsPlugin,
  LLMToolsProvider,
  PluginContext,
} from "whisplay-ai-chatbot/dist/plugin/types";
import type { LLMTool } from "whisplay-ai-chatbot/dist/type";

const plugin: LLMToolsPlugin = {
  name: "${name}",
  displayName: "${display_name}",
  version: "1.0.0",
  type: "llm-tools",
  description: "${display_name} tools plugin",

  activate(ctx: PluginContext): LLMToolsProvider {
    return {
      getTools(): LLMTool[] {
        return [
          {
            type: "function",
            function: {
              name: "myCustomTool",
              description: "A custom tool that does something useful",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Input query" },
                },
                required: ["query"],
              },
            },
          },
        ];
      },
    };
  },
};

export default plugin;
TSEOF
      ;;
  esac
}

# ── JavaScript entry templates ───────────────────────────────

_generate_js_entry() {
  local dest="$1" name="$2" ptype="$3" display_name="$4"
  local file="${dest}/index.js"

  case "$ptype" in
    asr)
      cat > "$file" << JSEOF
/** @type {import('whisplay-ai-chatbot/dist/plugin/types').ASRPlugin} */
module.exports = {
  name: "${name}",
  displayName: "${display_name}",
  version: "1.0.0",
  type: "asr",
  audioFormat: "wav",
  description: "${display_name} ASR plugin",

  activate(ctx) {
    const apiKey = ctx.pluginEnv.${name//[-]/_}_API_KEY;

    return {
      async recognizeAudio(audioPath) {
        // TODO: Implement speech recognition
        throw new Error("Not implemented");
      },
    };
  },
};
JSEOF
      ;;
    llm)
      cat > "$file" << JSEOF
/** @type {import('whisplay-ai-chatbot/dist/plugin/types').LLMPlugin} */
module.exports = {
  name: "${name}",
  displayName: "${display_name}",
  version: "1.0.0",
  type: "llm",
  description: "${display_name} LLM plugin",

  activate(ctx) {
    const apiKey = ctx.pluginEnv.${name//[-]/_}_API_KEY;
    let chatHistory = [];

    return {
      async chatWithLLMStream(inputMessages, partialCallback, endCallBack, partialThinkingCallback, invokeFunctionCallback) {
        // TODO: Implement streaming LLM chat
        partialCallback("Hello from ${display_name}!");
        endCallBack();
      },

      resetChatHistory() {
        chatHistory = [];
      },
    };
  },
};
JSEOF
      ;;
    tts)
      cat > "$file" << JSEOF
/** @type {import('whisplay-ai-chatbot/dist/plugin/types').TTSPlugin} */
module.exports = {
  name: "${name}",
  displayName: "${display_name}",
  version: "1.0.0",
  type: "tts",
  audioFormat: "mp3",
  description: "${display_name} TTS plugin",

  activate(ctx) {
    const apiKey = ctx.pluginEnv.${name//[-]/_}_API_KEY;

    return {
      async ttsProcessor(text) {
        // TODO: Implement text-to-speech
        // Return { filePath, duration } or { buffer, duration }
        throw new Error("Not implemented");
      },
    };
  },
};
JSEOF
      ;;
    image-generation)
      cat > "$file" << JSEOF
/** @type {import('whisplay-ai-chatbot/dist/plugin/types').ImageGenerationPlugin} */
module.exports = {
  name: "${name}",
  displayName: "${display_name}",
  version: "1.0.0",
  type: "image-generation",
  description: "${display_name} image generation plugin",

  activate(ctx) {
    const apiKey = ctx.pluginEnv.${name//[-]/_}_API_KEY;

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
                prompt: { type: "string", description: "Image description" },
              },
              required: ["prompt"],
            },
          },
        });
      },
    };
  },
};
JSEOF
      ;;
    vision)
      cat > "$file" << JSEOF
/** @type {import('whisplay-ai-chatbot/dist/plugin/types').VisionPlugin} */
module.exports = {
  name: "${name}",
  displayName: "${display_name}",
  version: "1.0.0",
  type: "vision",
  description: "${display_name} vision plugin",

  activate(ctx) {
    const apiKey = ctx.pluginEnv.${name//[-]/_}_API_KEY;

    return {
      addVisionTools(tools) {
        tools.push({
          type: "function",
          function: {
            name: "analyzeImage",
            description: "Analyze an image and describe its content",
            parameters: {
              type: "object",
              properties: {
                imagePath: { type: "string", description: "Path to the image" },
              },
              required: ["imagePath"],
            },
          },
        });
      },
    };
  },
};
JSEOF
      ;;
    llm-tools)
      cat > "$file" << JSEOF
/** @type {import('whisplay-ai-chatbot/dist/plugin/types').LLMToolsPlugin} */
module.exports = {
  name: "${name}",
  displayName: "${display_name}",
  version: "1.0.0",
  type: "llm-tools",
  description: "${display_name} tools plugin",

  activate(ctx) {
    return {
      getTools() {
        return [
          {
            type: "function",
            function: {
              name: "myCustomTool",
              description: "A custom tool that does something useful",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Input query" },
                },
                required: ["query"],
              },
            },
          },
        ];
      },
    };
  },
};
JSEOF
      ;;
  esac
}
