# Whisplay AI Chatbot - Agent Documentation

> **Note:** This file is intended for AI coding agents. Please keep it updated when making architectural changes.

## Project Overview

Whisplay AI Chatbot is a pocket-sized AI chatbot device built for Raspberry Pi Zero 2W / Pi 5. It features voice interaction (press button, speak, get spoken responses), an LCD display with emoji/status visualization, RGB LED indicators, and extensible AI backend support.

**Key Capabilities:**
- Multi-provider ASR (Automatic Speech Recognition): Tencent, Volcengine, OpenAI, Gemini, Whisper, Vosk, local models
- Multi-provider LLM: OpenAI, Gemini, Claude, Ollama, Qwen, Volcengine Doubao, and more
- Multi-provider TTS: Google, Volcengine, Piper, espeak-ng, local models
- Image generation and vision understanding
- RAG (Retrieval-Augmented Generation) with Qdrant vector database
- Wake word detection for hands-free operation
- Plugin system for third-party extensions
- Web-based display simulation for development

## Technology Stack

### Core Technologies
| Component | Technology |
|-----------|------------|
| Main Runtime | Node.js 20 + TypeScript |
| Hardware Interface | Python 3 + RPi.GPIO / gpiod |
| UI Rendering | Python Pillow (PIL) + socket communication |
| Package Manager | yarn (preferred) or npm |
| Build Tool | TypeScript Compiler (tsc) |

### Key Dependencies
- **Web Framework**: Koa.js (HTTP server)
- **WebSocket**: ws (real-time communication)
- **AI SDKs**: @anthropic-ai/sdk, openai, @google/genai
- **Vector DB**: @qdrant/js-client-rest
- **Hardware**: spidev, onnxruntime-node
- **Audio**: get-audio-duration, mp3-duration

### Hardware Requirements
- Raspberry Pi Zero 2W or Pi 5 (8GB RAM recommended for offline)
- PiSugar Whisplay HAT (LCD 240x280, speaker, microphone, RGB LED, button)
- PiSugar 3 battery (1200mAh or 5000mAh for Pi 5)
- WM8960 audio codec

## Project Structure

```
whisplay-ai-chatbot/
├── src/                          # Main TypeScript source code
│   ├── index.ts                  # Application entry point
│   ├── index-knowledge.ts        # Knowledge base indexing tool
│   ├── configure-env.ts          # Interactive .env configuration tool
│   ├── upgrade-env.ts            # Environment upgrade tool
│   ├── cloud-api/                # AI service providers
│   │   ├── interface.ts          # Common provider interfaces
│   │   ├── server.ts             # Provider factory/dispatcher
│   │   ├── proxy-fetch.ts        # Proxy-aware fetch wrapper
│   │   ├── type.d.ts             # Shared type definitions
│   │   ├── openai/               # OpenAI ASR/LLM/TTS/Vision
│   │   ├── gemini/               # Google Gemini services
│   │   ├── volcengine/           # ByteDance VolcEngine
│   │   ├── tencent/              # Tencent Cloud
│   │   ├── local/                # Local/offline providers
│   │   │   ├── ollama-*.ts       # Ollama integration
│   │   │   ├── whisper-*.ts      # Whisper ASR variants
│   │   │   ├── piper-*.ts        # Piper TTS
│   │   │   └── llm8850*.ts       # LLM8850 accelerator
│   │   └── ...
│   ├── core/                     # Core business logic
│   │   ├── ChatFlow.ts           # Main chat flow controller
│   │   ├── StreamResponsor.ts    # Streaming response handler
│   │   ├── Knowledge.ts          # RAG knowledge management
│   │   └── chat-flow/            # State machine for chat flow
│   ├── device/                   # Hardware abstraction
│   │   ├── display.ts            # LCD display controller
│   │   ├── audio.ts              # Audio playback/recording
│   │   ├── battery.ts            # Battery monitoring
│   │   ├── wakeword.ts           # Wake word detection
│   │   ├── web-display.ts        # Web-based display sim
│   │   └── ...
│   ├── plugin/                   # Plugin system
│   │   ├── types.ts              # Plugin interface definitions
│   │   ├── registry.ts           # Plugin registry
│   │   ├── loader.ts             # External plugin loader
│   │   └── builtin*.ts           # Built-in provider plugins
│   ├── config/                   # Configuration modules
│   │   ├── llm-config.ts         # LLM configuration
│   │   ├── llm-tools.ts          # Tool definitions
│   │   └── custom-tools/         # Custom tool templates
│   ├── utils/                    # Utility functions
│   └── type/                     # Global TypeScript types
├── python/                       # Python hardware interface
│   ├── whisplay.py               # Hardware board abstraction (GPIO, SPI, LCD)
│   ├── chatbot-ui.py             # UI rendering server (socket-based)
│   ├── camera.py                 # Camera module integration
│   ├── wakeword.py               # Wake word detection host
│   ├── utils.py                  # Python utilities
│   ├── speech-service/           # Speech recognition hosts
│   ├── status-bar-icon/          # UI icon renderers
│   └── test/                     # Hardware test scripts
├── cli/                          # Bash CLI implementation
│   ├── commands.sh               # Main command dispatcher
│   ├── plugin.sh                 # Plugin management
│   ├── plugin-create.sh          # Plugin scaffolding
│   └── service.sh                # systemd service management
├── bin/whisplay                  # CLI entry point (bash)
├── docker/                       # Docker compose for local services
│   ├── docker-compose.yml        # Ollama, faster-whisper, piper
│   ├── faster-whisper-http/      # Faster Whisper HTTP server
│   └── piper-http/               # Piper TTS HTTP server
├── wiki/                         # Documentation (GitHub wiki)
├── data/                         # Runtime data (recordings, images, knowledge)
└── patches/                      # patch-package patches
```

## Build and Development Commands

### Initial Setup
```bash
# Install all dependencies (Node.js, Python, fonts)
bash install_dependencies.sh

# Create environment file
cp .env.template .env
# Edit .env with your API keys and configuration
```

### Build Commands
```bash
# Build TypeScript (compiles src/ to dist/)
npm run build
# or
yarn build

# Full rebuild with dependencies
bash build.sh
```

### Run Commands
```bash
# Start the chatbot service
bash run_chatbot.sh

# Start with npm/yarn directly (after build)
npm start
# or
yarn start
```

### CLI Commands
The `whisplay` CLI is installed to `/usr/local/bin/whisplay` during setup:

```bash
# Plugin management
whisplay plugin create                    # Create new plugin from template
whisplay plugin install <github-url>      # Install plugin from GitHub
whisplay plugin remove <plugin-name>      # Remove installed plugin
whisplay plugin list                      # List installed plugins
whisplay plugin update <name|--all>       # Update plugin(s)

# Service management
whisplay service install                  # Install systemd service
whisplay service uninstall                # Remove systemd service
whisplay service start|stop|restart       # Control service
whisplay service status                   # Check service status

# Utilities
whisplay update                           # Pull latest code, install deps, build
whisplay configure                        # Interactively manage .env by category
whisplay index-knowledge                  # Index knowledge base
whisplay upgrade-env                      # Upgrade .env to latest template
whisplay help                             # Show help
```

### Knowledge Base Indexing
```bash
# Index documents for RAG
bash index_knowledge.sh
# or via CLI
whisplay index-knowledge
```

## Code Style and Conventions

### TypeScript
- **Target**: ES2020, CommonJS modules
- **Strict mode**: Enabled
- **Path resolution**: Use relative imports within src/
- **File naming**: kebab-case for files, PascalCase for classes

### Python
- **Style**: PEP 8
- **Hardware abstraction**: `python/whisplay.py` provides cross-platform GPIO
- **Platform support**: Raspberry Pi (RPi.GPIO) and Radxa (gpiod)

### Key Conventions
1. **Environment variables**: All configuration via `.env` file, accessed through `process.env`
2. **Audio files**: Stored in `data/recordings/`, auto-cleaned on startup if configured
3. **Plugin development**: Always read config from `ctx.env`, never `process.env` directly
4. **Error handling**: Use try-catch with meaningful error messages; hardware errors should be non-fatal where possible
5. **Logging**: Use `console.log/time/timeEnd` for debugging; Python side uses print with prefixes like `[Server]`, `[Camera]`

## Plugin System Architecture

### Plugin Types
| Type | Interface | Environment Variable |
|------|-----------|---------------------|
| ASR | `ASRProvider.recognizeAudio()` | `ASR_SERVER` |
| LLM | `LLMProvider.chatWithLLMStream()` | `LLM_SERVER` |
| TTS | `TTSProvider.ttsProcessor()` | `TTS_SERVER` |
| Image Generation | `ImageGenerationProvider.addImageGenerationTools()` | `IMAGE_GENERATION_SERVER` |
| Vision | `VisionProvider.addVisionTools()` | `VISION_SERVER` |
| LLM Tools | `LLMToolsProvider.getTools()` | *(all active)* |

### Plugin Loading Order
1. Built-in plugins registered
2. `plugins/` directory (alphabetical)
3. `whisplay-plugin-*` npm packages (alphabetical)
4. Later plugins override earlier ones with same name

### Creating a Plugin
```bash
# Use CLI for scaffolding
whisplay plugin create

# Or manual: create in plugins/my-plugin/index.js
module.exports = {
  name: "my-plugin",
  displayName: "My Plugin",
  version: "1.0.0",
  type: "tts", // or "asr", "llm", etc.
  activate(ctx) {
    // ctx.env - merged global + plugin env
    // ctx.pluginEnv - plugin-only env
    // ctx.imageDir - output directory for images
    // ctx.ttsDir - temp directory for TTS
    return {
      async ttsProcessor(text) {
        // Implementation
        return { buffer, duration };
      }
    };
  }
};
```

## Hardware Abstraction Layer

### WhisplayBoard Class (`python/whisplay.py`)
Cross-platform hardware abstraction supporting Raspberry Pi and Radxa boards:

```python
whisplay = WhisplayBoard()  # Auto-detects platform
whisplay.set_rgb(r, g, b)   # RGB LED control
whisplay.set_backlight(brightness)  # LCD backlight (0-100)
whisplay.draw_image(x, y, w, h, rgb565_data)  # Display buffer
whisplay.on_button_press(callback)
whisplay.on_button_release(callback)
```

### Communication Protocol
- **Node.js** (TypeScript) ↔ **Python** (UI renderer) via TCP socket on port 12345
- JSON messages with newline delimiter
- Key message types: `button_pressed`, `button_released`, `camera_capture`, display updates

### Display Update Format
```typescript
display({
  status: "listening" | "thinking" | "answering",
  emoji: "🤔",
  text: "Display text",
  RGB: "#ff6800",        // LED color
  brightness: 100,        // Backlight level
  scroll_speed: 3,        // Text scroll speed
  scroll_sync: {          // Sync scroll with TTS
    char_end: 50,
    duration_ms: 2000
  },
  battery_level: 85,
  battery_color: "#34d351",
  image: "/path/to/image.png"
});
```

## State Machine

The chat flow uses a finite state machine (`src/core/chat-flow/stateMachine.ts`):

| State | Description |
|-------|-------------|
| `sleep` | Idle, waiting for button press or wake word |
| `wake_listening` | Wake word activated, listening for speech |
| `listening` | Button pressed, recording audio |
| `recognizing` | ASR processing |
| `thinking` | LLM generating response |
| `answering` | TTS playing response |
| `camera_mode` | Camera preview active |
| `external_answer` | IM bridge receiving external message |

State transitions are triggered by button events, wake word detection, or completion of async operations.

## Testing Strategy

### Unit Testing
- Currently minimal test coverage (`npm test` returns placeholder)
- Test scripts in `python/test/` for hardware validation

### Integration Testing
```bash
# Test hardware components
python3 python/test/led.py      # RGB LED test
python3 python/test/key.py      # Button test
python3 python/test/socket-test.py  # Socket communication test

# Test VLM multi-turn
python3 python/test/test_vlm_multiturn.py
```

### Web Display for Development
Enable web-based display simulation without physical hardware:
```bash
# .env
WHISPLAY_WEB_ENABLED=true
WHISPLAY_WEB_PORT=17880
WEB_AUDIO_ENABLED=true      # Use browser mic/speaker
WEB_CAMERA_ENABLED=true     # Use browser camera
```

## Deployment Process

### Systemd Service Setup
```bash
# Install and enable auto-start
bash startup.sh
# or
whisplay service install

# Service file location: /etc/systemd/system/chatbot.service
# Logs: ~/whisplay-ai-chatbot/chatbot.log

# View logs
tail -f chatbot.log
sudo journalctl -u chatbot.service -f
```

### Docker Services (Optional)
For local AI services without cloud dependencies:
```bash
cd docker
docker-compose up -d  # Starts Ollama, faster-whisper, piper-http
```

### Environment Upgrade
When `.env.template` changes:
```bash
whisplay upgrade-env
# or
bash upgrade-env.sh
```

## Security Considerations

1. **API Keys**: Store all API keys in `.env` file only; never commit to git
2. **Plugin Isolation**: Plugins receive scoped environment via `ctx.env`; cannot access other plugins' `.env` files
3. **Network**: HTTP proxy support via `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY` environment variables
4. **Local Services**: Ollama and local speech services bind to localhost by default
5. **File Permissions**: Service runs as user with `audio`, `video`, `gpio` groups

## Common Development Tasks

### Adding a New AI Provider
1. Create provider files in `src/cloud-api/<provider>/`
2. Implement interface from `src/cloud-api/interface.ts`
3. Add to `src/cloud-api/server.ts` dispatcher
4. Add type definitions to `src/type/index.ts`
5. Document in `.env.template`

### Adding a New Tool for LLM
1. Define tool schema in `src/config/llm-tools.ts`
2. Implement handler function
3. Or create `llm-tools` plugin for third-party tools

### Web Search
The chatbot supports web search functionality via multiple providers:

**Supported Providers:**
| Provider | API Key Required | Features |
|----------|------------------|----------|
| Tavily | `TAVILY_API_KEY` | AI-optimized search, recommended |
| SerpAPI | `SERP_API_KEY` | Google Search results |
| Bing | `BING_SEARCH_API_KEY` | Microsoft Bing Search |
| Google | `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX` | Custom Search API |

**Configuration:**
```bash
# Enable web search
WEB_SEARCH_ENABLED=true

# Select provider (default: tavily)
WEB_SEARCH_PROVIDER=tavily

# Optional: max results (default: 5)
WEB_SEARCH_MAX_RESULTS=5

# Optional: enable image search
WEB_SEARCH_INCLUDE_IMAGES=false
```

**Usage:** Once enabled, LLM automatically uses `webSearch` tool when users ask about current events, news, or time-sensitive information.

### Modifying UI/Display
1. Python rendering: `python/chatbot-ui.py` (RenderThread class)
2. Status icons: `python/status-bar-icon/` directory
3. Node.js controller: `src/device/display.ts`

### Troubleshooting
- **Audio issues**: Check `amixer` output, verify WM8960 driver loaded
- **Display not updating**: Check socket connection on port 12345
- **GPIO errors**: Verify user in `gpio` group, check platform detection
- **Build errors**: Ensure Node.js 20, run `bash build.sh` to reset

## Data Directories

| Directory | Purpose | Cleanup |
|-----------|---------|---------|
| `data/recordings/` | Audio recordings | Auto-clean on start if configured |
| `data/images/` | Generated images | Manual cleanup |
| `data/knowledge/` | RAG document storage | Manual cleanup |
| `data/db/` | Qdrant vector database | Manual cleanup |

Set `CLEAN_DATA_FOLDER_ON_START=true` in `.env` to clear recordings on startup.

---

## Resources

- **Project Wiki**: https://github.com/PiSugar/whisplay-ai-chatbot/wiki
- **Hardware Docs**: https://docs.pisugar.com/
- **Discord**: https://discord.gg/H7pb4M32
- **License**: GPL-3.0
