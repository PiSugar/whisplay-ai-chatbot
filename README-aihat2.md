# Raspberry Pi AI Hat+ 2 Integration

This document explains how to set up the **Raspberry Pi AI Hat+ 2** (Hailo-10H)
with the Whisplay AI Chatbot, covering ASR, LLM, TTS, and Vision services.

> **Hardware note:** AI HAT+ 2 uses the Hailo-10H chip. It requires the `hailo-h10-all`
> package, which is **different from** `hailo-all` used by the AI Kit / AI HAT+.
> They cannot coexist on the same OS installation.
> See the [official Software prerequisites](https://www.raspberrypi.com/documentation/computers/ai.html#software).

---

## ⚠️ Hardware Limitation: NPU Memory Exclusivity

The Hailo-10H on-chip SRAM is **not large enough** to hold two neural network
models simultaneously — **ASR (Whisper)**, **LLM (hailo-ollama)**, and **VLM**
are mutually exclusive. The `HailoRT` multi-process sharing service is not
included in the `h10-hailort` package.

Only **one** of the three NPU services can be active at a time. For whichever
service is not running on the NPU, use a CPU-based or cloud alternative.
The sections below cover each service independently.

---

## Architecture Overview

```
┌─────────────────────────── Raspberry Pi 5 (AI HAT+ 2) ────────────────────────────┐
│                                                                                   │
│                                                                                   │
│   ╔══════════════ Hailo-10H NPU  (one model loaded at a time) ════════╗           │
│   ║                                                                   ║           │
│   ║  hailo-whisper-host.py :8807  (Whisper-Base.hef)  ← ASR           ║           │
│   ║                         ── OR ──                                  ║           │
│   ║  hailo-ollama          :8000  (qwen2.5-instruct)  ← LLM           ║           │
│   ║                         ── OR ──                                  ║           │
│   ║  hailo-vlm-host.py     :8808  (VLM .hef)          ← Vision        ║           │
│   ╚═══════════════════════════════════════════════════════════════════╝           │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 1 — System Setup (Required)

### 1.1 Update Raspberry Pi OS

```bash
sudo apt update && sudo apt full-upgrade -y
sudo rpi-eeprom-update -a
sudo reboot
```

### 1.2 Install Hailo System Packages

> ⚠️ **AI HAT+ 2 requires `hailo-h10-all`** — do **not** install `hailo-all`.

```bash
sudo apt update
sudo apt install -y hailo-h10-all
sudo reboot
```

Verify after reboot:
```bash
hailortcli fw-control identify
# Expected: Device Architecture: HAILO10H
```

> **Troubleshooting — `/dev/hailo0` missing:**
> Blacklist the old `hailo_pci` module (for Hailo-8) which conflicts with `hailo1x_pci`:
> ```bash
> echo "blacklist hailo_pci" | sudo tee /etc/modprobe.d/blacklist-hailo-h8.conf
> echo "install hailo_pci /bin/true" | sudo tee -a /etc/modprobe.d/blacklist-hailo-h8.conf
> sudo update-initramfs -u
> sudo reboot
> ```
> After reboot, `lsmod | grep hailo` should show only `hailo1x_pci`.

### 1.3 Install hailo-apps (GenAI Python Stack)

Required for both Hailo Whisper ASR and Hailo VLM.

```bash
git clone https://github.com/hailo-ai/hailo-apps.git ~/hailo-apps
cd ~/hailo-apps
sudo ./install.sh
source setup_env.sh
pip install -e ".[gen-ai]"
```

---

## Hailo Whisper ASR (port 8807)

Runs speech recognition on the Hailo-10H NPU.

> ⚠️ **NPU exclusive.** Stop `hailo-ollama` and `hailo-vlm` before starting this service.
> Use a cloud or CPU-based LLM (e.g. `gemini`) alongside it.

### Download the Model

```bash
source ~/hailo-apps/setup_env.sh
hailo-download-resources --group whisper_chat --arch hailo10h
# Model saved to: /usr/local/hailo/resources/whisper_chat/Whisper-Base.hef (~131 MB)
```

### Test Standalone

```bash
source ~/hailo-apps/setup_env.sh
python3 ~/whisplay-ai-chatbot/python/speech-service/hailo-whisper-host.py --port 8807
```

Once you see `Listening for requests...`, test with:
```bash
# Health check
curl http://localhost:8807/health
# Expected: {"hailo":true,"status":"ok"}

# Transcription test (16 kHz mono WAV)
curl -s -X POST http://localhost:8807/transcribe \
  -F "audio=@/path/to/test.wav" | python3 -m json.tool
```

### systemd Service

```bash
cat > /tmp/hailo-whisper.service << 'EOF'
[Unit]
Description=Hailo Whisper ASR HTTP Service
After=network.target

[Service]
User=pi
Environment="PATH=/home/pi/hailo-apps/venv_hailo_apps/bin:/usr/local/bin:/usr/bin:/bin"
WorkingDirectory=/home/pi/hailo-apps
ExecStart=/home/pi/hailo-apps/venv_hailo_apps/bin/python3 \
  /home/pi/whisplay-ai-chatbot/python/speech-service/hailo-whisper-host.py --port 8807
Restart=on-failure
StandardOutput=append:/home/pi/hailo-whisper.log
StandardError=append:/home/pi/hailo-whisper-err.log

[Install]
WantedBy=multi-user.target
EOF

sudo mv /tmp/hailo-whisper.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable hailo-whisper.service
sudo systemctl start hailo-whisper.service
sudo systemctl status hailo-whisper.service
```

View logs:

```bash
journalctl -u hailo-whisper -f
```

### Whisplay `.env`

```dotenv
ASR_SERVER=hailowhisper
HAILO_WHISPER_HOST=localhost
HAILO_WHISPER_PORT=8807
HAILO_WHISPER_LANGUAGE=en
```

---

## Hailo-Ollama LLM (port 8000)

Runs a quantised LLM on the Hailo-10H NPU via an Ollama-compatible REST API.

> ⚠️ **NPU exclusive.** Stop `hailo-whisper` and `hailo-vlm` before starting this service.
> Use a cloud or CPU-based ASR (e.g. Faster-Whisper, Gemini) alongside it.

### Install the Hailo GenAI Model Zoo

`hailo-ollama` is shipped as part of the Hailo GenAI Model Zoo Debian package:

```bash
curl -L -o /tmp/hailo_gen_ai_model_zoo.deb \
  https://dev-public.hailo.ai/2025_12/Hailo10/hailo_gen_ai_model_zoo_5.1.1_arm64.deb
sudo dpkg -i /tmp/hailo_gen_ai_model_zoo.deb
which hailo-ollama   # should return /usr/bin/hailo-ollama
```

> Alternative: download from the [Hailo Developer Zone](https://hailo.ai/developer-zone/)
> (free account) under the AI HAT+ 2 section.

### Pull a Model

> ⚠️ Model blobs must be downloaded via the **REST API** while the server is running.
> The CLI `hailo-ollama pull` starts its own server and does not connect to an existing one.

```bash
# Start the server in one terminal
hailo-ollama

# In another terminal — pull a model (streaming progress)
curl -s http://localhost:8000/api/pull \
  -H 'Content-Type: application/json' \
  -d '{"model": "qwen2.5-instruct:1.5b", "stream": true}'
```

Available models (bundled manifests in the deb package):

| Model                     | Size    | Notes                               |
|---------------------------|---------|-------------------------------------|
| `qwen2.5-instruct:1.5b`   | ~1 GB   | Recommended — good speed/quality    |
| `llama3.2:1b`             | ~650 MB | Fastest                             |
| `qwen2.5-instruct:3b`     | ~2 GB   | Better quality, slower              |

### Test Standalone

```bash
# List loaded models
curl -s http://localhost:8000/api/tags | python3 -m json.tool

# Chat test
curl -s http://localhost:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen2.5-instruct:1.5b",
       "messages":[{"role":"user","content":"Say hello in one sentence."}],
       "stream":false}' | python3 -m json.tool
```

### systemd Service

```bash
cat > /tmp/hailo-ollama.service << 'EOF'
[Unit]
Description=Hailo Ollama LLM Service
After=network.target

[Service]
User=pi
Environment="PATH=/usr/local/bin:/usr/bin:/bin:/home/pi/.local/bin"
ExecStart=/usr/bin/hailo-ollama
Restart=on-failure
StandardOutput=append:/home/pi/hailo-ollama.log
StandardError=append:/home/pi/hailo-ollama-err.log

[Install]
WantedBy=multi-user.target
EOF

sudo mv /tmp/hailo-ollama.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable hailo-ollama.service
sudo systemctl start hailo-ollama.service
sudo systemctl status hailo-ollama.service
```

View logs:

```bash
journalctl -u hailo-ollama -f
```

### Whisplay `.env`

```dotenv
LLM_SERVER=ollama
OLLAMA_ENDPOINT=http://localhost:8000
OLLAMA_MODEL=qwen2.5-instruct:1.5b
OLLAMA_ENABLE_TOOLS=false
```

---

## Hailo VLM Vision (port 8808, optional)

Runs vision/image-understanding on the Hailo-10H NPU, exposing an OpenAI-compatible
`/v1/chat/completions` endpoint.

> ⚠️ **NPU exclusive.** The VLM HEF is ~2 GB. Stop `hailo-whisper` and `hailo-ollama` before starting.
> Use cloud ASR and LLM alongside it.

### Install Dependencies

```bash
pip install flask opencv-python-headless pillow --break-system-packages
```

### Download the Model

```bash
source ~/hailo-apps/setup_env.sh
hailo-download-resources --group vlm_chat --arch hailo10h
# ~2 GB HEF — download may take several minutes
```

### Test Standalone

```bash
source ~/hailo-apps/setup_env.sh
python3 ~/whisplay-ai-chatbot/python/speech-service/hailo-vlm-host.py --port 8808
```

Test in another terminal with:

```bash
# Health check
curl http://localhost:8808/health

# Vision test (supply a JPEG/PNG image as base64)
curl -s http://localhost:8808/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "hailo-vlm",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "What is in this image?"},
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,<BASE64>"}}
      ]
    }]
  }' | python3 -m json.tool
```

### systemd Service

```bash
cat > /tmp/hailo-vlm.service << 'EOF'
[Unit]
Description=Hailo VLM Vision HTTP Service
After=network.target

[Service]
User=pi
Environment="PATH=/home/pi/hailo-apps/venv_hailo_apps/bin:/usr/local/bin:/usr/bin:/bin"
WorkingDirectory=/home/pi/hailo-apps
ExecStart=/home/pi/hailo-apps/venv_hailo_apps/bin/python3 \
  /home/pi/whisplay-ai-chatbot/python/speech-service/hailo-vlm-host.py --port 8808
Restart=on-failure
StandardOutput=append:/home/pi/hailo-vlm.log
StandardError=append:/home/pi/hailo-vlm-err.log

[Install]
WantedBy=multi-user.target
EOF

sudo mv /tmp/hailo-vlm.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable hailo-vlm.service
sudo systemctl start hailo-vlm.service
sudo systemctl status hailo-vlm.service
```

View logs:

```bash
journalctl -u hailo-vlm -f
```

### Whisplay `.env`

```dotenv
VISION_SERVER=openai
OPENAI_API_KEY=placeholder
OPENAI_API_BASE_URL=http://localhost:8808/v1
OPENAI_VISION_MODEL=hailo-vlm
OPENAI_USE_SINGLE_MESSAGE_PAYLOAD=true
ENABLE_CAMERA=true
USE_CAPTURED_IMAGE_IN_CHAT=true
```

---

## Switching NPU Services

Stop the current NPU service before starting another to avoid `Device busy` errors:

```bash
# Switch from Whisper ASR to hailo-ollama LLM
sudo systemctl stop hailo-whisper.service
sudo systemctl start hailo-ollama.service

# Switch back
sudo systemctl stop hailo-ollama.service
sudo systemctl start hailo-whisper.service
```

Piper TTS runs on the CPU and is never affected by NPU switches.

---

## Service Startup Times

Services take time to load models after boot. Wait ~60 s after `systemctl start`
before sending requests.

| Service              | Approximate startup time |
|----------------------|--------------------------|
| hailo-whisper (ASR)  | ~10–20 s                 |
| hailo-ollama (LLM)   | ~30–60 s                 |
| hailo-vlm (Vision)   | ~20–40 s                 |
| piper-http (TTS)     | ~5 s (CPU, auto-started) |

---

## Quick Reference

| Component         | Start                                | Stop                                | Status |
|-------------------|--------------------------------------|-------------------------------------|--------|
| Hailo Whisper ASR | `sudo systemctl start hailo-whisper` | `sudo systemctl stop hailo-whisper` | `sudo systemctl status hailo-whisper` |
| Hailo Ollama LLM  | `sudo systemctl start hailo-ollama`  | `sudo systemctl stop hailo-ollama`  | `sudo systemctl status hailo-ollama` |
| Hailo VLM Vision  | `sudo systemctl start hailo-vlm`     | `sudo systemctl stop hailo-vlm`     | `sudo systemctl status hailo-vlm` |

---

## References

- [Raspberry Pi AI software](https://www.raspberrypi.com/documentation/computers/ai.html#software) — driver setup
- [Raspberry Pi AI HAT+ documentation](https://www.raspberrypi.com/documentation/accessories/ai-hat-plus.html)
- [hailo-apps repository](https://github.com/hailo-ai/hailo-apps)
- [Hailo GenAI Apps README](https://github.com/hailo-ai/hailo-apps/tree/main/hailo_apps/python/gen_ai_apps)
- [Hailo Ollama Guide](https://github.com/hailo-ai/hailo-apps/blob/main/hailo_apps/python/gen_ai_apps/hailo_ollama/README.md)
- [Piper TTS wiki](https://github.com/PiSugar/whisplay-ai-chatbot/wiki/TTS-%E2%80%90-piper%E2%80%90http)
- [Hailo Developer Zone](https://hailo.ai/developer-zone/)

