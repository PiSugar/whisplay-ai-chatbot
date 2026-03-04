# Raspberry Pi AI Hat+ 2 Integration

This document explains how to set up and integrate the **Raspberry Pi AI Hat+ 2** (Hailo-10H, 40 TOPS)
with the Whisplay AI Chatbot, covering ASR, LLM, TTS, and Vision services.

All third-party services run **independently** from the Whisplay process and communicate via HTTP,
which minimises coupling and lets each component be upgraded or replaced in isolation. The complete
setup is managed through a one-command deploy script: `scripts/deploy-aihat2.sh`.

> **Hardware note:** AI HAT+ 2 uses the Hailo-10H chip (40 TOPS). It requires the `hailo-h10-all`  
> package, which is **different from** `hailo-all` used by the AI Kit / AI HAT+. They cannot coexist on
> the same OS installation. See the [official Software prerequisites](https://www.raspberrypi.com/documentation/computers/ai.html#software).

---

## Architecture Overview

```
┌─────────────────────────── Raspberry Pi 5 (AI HAT+ 2) ──────────────────────────┐
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────┐           │
│   │                     Whisplay AI Chatbot                          │           │
│   │   ASR_SERVER=hailowhisper  ──► localhost:8807  (custom HTTP)    │           │
│   │   LLM_SERVER=ollama        ──► localhost:8000  (Ollama API)     │           │
│   │   TTS_SERVER=piper-http    ──► localhost:8805  (piper HTTP)     │           │
│   │   VISION_SERVER=openai     ──► localhost:8808  (OpenAI API)     │           │
│   └──────────────────────────────────────────────────────────────────┘           │
│                                                                                  │
│   ╔══════════════════════════════ Hailo-10H NPU ═══════════════════════╗          │
│   ║                                                                    ║          │
│   ║  hailo-whisper-host.py :8807   hailo-ollama :8000 (hailo-ollama)  ║          │
│   ║  (Whisper-Base HEF)            (qwen2.5-instruct:1.5b)            ║          │
│   ║                                                                    ║          │
│   ║  hailo-vlm-host.py :8808  [optional – requires separate context]  ║          │
│   ║  (VLM HEF – vision Q&A)                                           ║          │
│   ╚════════════════════════════════════════════════════════════════════╝          │
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────┐                   │
│   │  piper-http TTS :8805  (Pi 5 CPU · system pip)            │                   │
│   │  python3 -m piper.http_server  ← piper-tts==1.3.0        │                   │
│   └──────────────────────────────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

| Component         | Compute     | Protocol        | Port |
|-------------------|-------------|-----------------|------|
| Hailo Whisper ASR | Hailo-10H   | Custom HTTP     | 8807 |
| Hailo-Ollama LLM  | Hailo-10H   | Ollama REST API | 8000 |
| Piper TTS         | Pi 5 CPU    | Piper HTTP API  | 8805 |
| Hailo VLM Vision  | Hailo-10H   | OpenAI REST API | 8808 |

> **TTS note:** Hailo-10H does not include a dedicated TTS NPU model. Piper TTS runs on the Pi 5 CPU,  
> which is fast enough for real-time synthesis. It is installed directly via `pip install piper-tts==1.3.0`  
> and served via `python3 -m piper.http_server`. See the [piper-http wiki page](https://github.com/PiSugar/whisplay-ai-chatbot/wiki/TTS-%E2%80%90-piper%E2%80%90http) for full details.

---

## Prerequisites

### 1. Update Raspberry Pi OS

Ensure you are running Raspberry Pi OS **Trixie** (Debian 12) with the latest packages:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo rpi-eeprom-update -a
sudo reboot
```

### 2. Install Hailo System Packages

> ⚠️ **AI HAT+ 2 requires `hailo-h10-all`**, which is **different** from `hailo-all` (used by
> AI Kit / AI HAT+). Do **not** install both — they conflict.

```bash
sudo apt update
sudo apt install -y hailo-h10-all
sudo reboot
```

Verify the device is detected after reboot:

```bash
hailortcli fw-control identify
# Expected: Device Architecture: HAILO10H
```

Also check kernel logs:
```bash
dmesg | grep -i hailo | tail -20
# Expected final line: Probing: Added board ...  /dev/hailo0
```

> **Troubleshooting — `/dev/hailo0` missing after install:**  
> Raspberry Pi OS ships a built-in `hailo_pci` kernel module (for the Hailo-8 AI Kit/HAT+)  
> alongside the new `hailo1x_pci` module. Both may try to bind the device, causing  
> `probe with driver hailo1x failed with error -17 (-EEXIST)`.  
> Fix: blacklist the old module and regenerate initramfs:
> ```bash
> echo "blacklist hailo_pci" | sudo tee /etc/modprobe.d/blacklist-hailo-h8.conf
> echo "install hailo_pci /bin/true" | sudo tee -a /etc/modprobe.d/blacklist-hailo-h8.conf
> sudo update-initramfs -u
> sudo reboot
> ```
> After reboot, `lsmod | grep hailo` should show only `hailo1x_pci`.

### 3. Install Hailo Apps (GenAI stack for ASR)

```bash
git clone https://github.com/hailo-ai/hailo-apps.git ~/hailo-apps
cd ~/hailo-apps
sudo ./install.sh
# Activate the virtual environment created by install.sh
source setup_env.sh
# Install GenAI dependencies (for Whisper and LLM inference)
pip install -e ".[gen-ai]"
```

### 3b. Install Piper TTS

Piper runs on the Pi CPU and does **not** need the hailo-apps venv.  
Install it system-wide following the [piper-http wiki page](https://github.com/PiSugar/whisplay-ai-chatbot/wiki/TTS-%E2%80%90-piper%E2%80%90http):

```bash
# piper-tts 1.4.0 has issues — use 1.3.0
pip install piper-tts==1.3.0 --break-system-packages
pip install 'piper-tts[http]' --break-system-packages
```

### 4. Download GenAI Models

```bash
# Activate the hailo-apps venv first
source ~/hailo-apps/setup_env.sh

# Whisper ASR model (Whisper-Base HEF, ~145 MB)
hailo-download-resources --group whisper_chat --arch hailo10h

# Piper TTS voice model (CPU inference, ~65 MB)
mkdir -p ~/piper
cd ~/piper
python3 -m piper.download_voices en_US-amy-medium
# For Chinese TTS (medium quality):
# python3 -m piper.download_voices zh_CN-huayan-medium

# VLM model for optional Vision support (~2 GB HEF)
# hailo-download-resources --group vlm_chat --arch hailo10h
```

Piper models are stored in `~/piper/`. Hailo HEF and resource files are stored in  
`/usr/local/hailo/resources/` (managed by `hailo-download-resources`).

### 5. Install the Hailo GenAI Model Zoo (for hailo-ollama LLM)

Download the Hailo GenAI Model Zoo Debian package directly:

```bash
curl -L -o /tmp/hailo_gen_ai_model_zoo.deb \
  https://dev-public.hailo.ai/2025_12/Hailo10/hailo_gen_ai_model_zoo_5.1.1_arm64.deb
sudo dpkg -i /tmp/hailo_gen_ai_model_zoo.deb
```

> Alternative: download from the [Hailo Developer Zone](https://hailo.ai/developer-zone/)  
> (requires free account) under the AI HAT+ 2 section.

Verify: `which hailo-ollama` should return a path.

---

## Service Setup

Each service runs as a standalone **systemd** unit that starts at boot,
independent of Whisplay.

### Hailo Whisper ASR (port 8807)

The `hailo-whisper-host.py` script in this repository wraps the Hailo-10H
Whisper model as an HTTP service.

**Test it once manually:**

```bash
source ~/hailo-apps/setup_env.sh
python3 ~/whisplay-ai-chatbot/python/speech-service/hailo-whisper-host.py --port 8807
```

**Create a systemd service:**

```bash
cat > /tmp/hailo-whisper.service << 'EOF'
[Unit]
Description=Hailo Whisper ASR HTTP Service
After=network.target

[Service]
User=pi
Environment="PATH=/home/pi/hailo-apps/venv_hailo_apps/bin:/usr/local/bin:/usr/bin:/bin"
WorkingDirectory=/home/pi/hailo-apps
ExecStart=/home/pi/hailo-apps/venv_hailo_apps/bin/python3 /home/pi/whisplay-ai-chatbot/python/speech-service/hailo-whisper-host.py --port 8807
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
```

**Check it is running:**

```bash
sudo systemctl status hailo-whisper.service
curl http://localhost:8807/health
```

---

### Hailo-Ollama LLM (port 8000)

The **Hailo GenAI Model Zoo** ships `hailo-ollama`, an Ollama-compatible REST
API server that runs LLM inference on the Hailo-10H chip.

#### Step 1 — Start hailo-ollama and pull a model

```bash
# Start the Ollama-compatible server
hailo-ollama &

# Pull Qwen2.5-Instruct 1.5B (recommended for Pi 5 memory constraints)
curl -s http://localhost:8000/api/pull \
  -H 'Content-Type: application/json' \
  -d '{"model": "qwen2.5-instruct:1.5b", "stream": true}'
```

Test if the model is working:

```bash
curl -s http://localhost:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"model": "qwen2.5-instruct:1.5b", "messages": [{"role": "user", "content": "Hello, world!"}], "stream": true}'
```

Available models (may vary by GenAI Model Zoo version):

| Model | Size | Notes |
|-------|------|-------|
| `qwen2.5-instruct:1.5b` | ~1 GB | Recommended — good speed/quality |
| `llama3.2:1b`           | ~650 MB | Fastest |
| `qwen2.5-instruct:3b`   | ~2 GB | Better quality, slower |

#### Step 2 — Create systemd service

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
```

> **Note:** If port `8000` conflicts with another service, add `--port XXXX`
> to the `ExecStart` line and set `OLLAMA_ENDPOINT` accordingly.

---

### Piper TTS (port 8805)

Piper TTS runs on the **Pi 5 CPU**. It is installed directly via `pip` (no hailo-apps venv needed).  
The Pi 5 CPU handles synthesis with very low latency (~100 ms).

Full setup details: [TTS ‐ piper‐http wiki](https://github.com/PiSugar/whisplay-ai-chatbot/wiki/TTS-%E2%80%90-piper%E2%80%90http)


**`.env` settings:**
```dotenv
TTS_SERVER=piper-http
PIPER_HTTP_MODEL=/home/pi/piper/en_US-amy-medium
# PIPER_HTTP_HOST=localhost
# PIPER_HTTP_PORT=8805
```

### Hailo VLM Vision Service (port 8808, optional)

Provides an **OpenAI-compatible** `/v1/chat/completions` endpoint backed by the
Hailo VLM model for image understanding during camera-enabled conversations.

> **Memory note:** The Hailo-10H NPU has limited on-chip memory.
> You can run **either** Whisper **or** VLM on the NPU, **not both simultaneously**
> unless hailo-apps supports the `SHARED_VDEVICE_GROUP_ID` multiplexing for your
> firmware version. Check `hailortcli fw-control identify` – if `Multi-Context` is
> `Enabled`, both can share the device.

**Install dependencies:**

```bash
pip install flask opencv-python-headless pillow --break-system-packages
```

**Test manually:**

```bash
source ~/hailo-apps/setup_env.sh
python3 ~/whisplay-ai-chatbot/python/speech-service/hailo-vlm-host.py --port 8808
curl http://localhost:8808/health
```

**systemd service:**

```bash
cat > /tmp/hailo-vlm.service << 'EOF'
[Unit]
Description=Hailo VLM Vision HTTP Service
After=network.target

[Service]
User=pi
Environment="PATH=/home/pi/hailo-apps/venv_hailo_apps/bin:/usr/local/bin:/usr/bin:/bin"
WorkingDirectory=/home/pi/hailo-apps
ExecStart=/home/pi/hailo-apps/venv_hailo_apps/bin/python3 /home/pi/whisplay-ai-chatbot/python/speech-service/hailo-vlm-host.py --port 8808
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
```

---

## Environment Configuration

Copy `.env.template` to `.env` and choose the mode that fits your use case.

### Option 1 — Text-only (Whisper + Hailo LLM + Piper TTS)

```dotenv
ASR_SERVER=hailowhisper
LLM_SERVER=ollama
TTS_SERVER=piper-http

# Hailo services
HAILO_WHISPER_HOST=localhost
HAILO_WHISPER_PORT=8807
HAILO_WHISPER_LANGUAGE=en

# hailo-ollama serves the Ollama-compatible API on port 8000
OLLAMA_ENDPOINT=http://localhost:8000
OLLAMA_MODEL=qwen2.5-instruct:1.5b
OLLAMA_ENABLE_TOOLS=false
ENABLE_THINKING=false

# Piper TTS
PIPER_HTTP_HOST=localhost
PIPER_HTTP_PORT=8805
PIPER_HTTP_MODEL=/home/pi/piper/en_US-amy-medium
```

### Option 2 — Multimodal (Whisper + Hailo LLM + Piper TTS + Hailo VLM)

```dotenv
ASR_SERVER=hailowhisper
LLM_SERVER=ollama
TTS_SERVER=piper-http

# Hailo ASR
HAILO_WHISPER_HOST=localhost
HAILO_WHISPER_PORT=8807
HAILO_WHISPER_LANGUAGE=en

# Hailo LLM (via hailo-ollama)
OLLAMA_ENDPOINT=http://localhost:8000
OLLAMA_MODEL=qwen2.5-instruct:1.5b
OLLAMA_ENABLE_TOOLS=false
ENABLE_THINKING=false

# Piper TTS
PIPER_HTTP_HOST=localhost
PIPER_HTTP_PORT=8805
PIPER_HTTP_MODEL=/home/pi/piper/en_US-amy-medium

# Hailo VLM vision service (OpenAI-compatible endpoint)
VISION_SERVER=openai
OPENAI_API_KEY=placeholder
OPENAI_API_BASE_URL=http://localhost:8808/v1
OPENAI_VISION_MODEL=hailo-vlm
OPENAI_USE_SINGLE_MESSAGE_PAYLOAD=true
OPENAI_ENABLE_TOOLS=false

# Camera (double-click button to capture in idle state)
ENABLE_CAMERA=true
USE_CAPTURED_IMAGE_IN_CHAT=true
```

---

## Memory & Multi-Context Note

All three GenAI workloads (Whisper, LLM, VLM) compete for the Hailo-10H's
on-chip SRAM.  
- **hailo-ollama** and **hailo-whisper-host.py** both use `SHARED_VDEVICE_GROUP_ID`
  so they can coexist on the same physical device.
- The **VLM** model is very large (~2 GB HEF) and requires loading its own
  context. If you encounter `Device busy` errors, stop the VLM service before
  starting the LLM service (or vice versa):

  ```bash
  sudo systemctl stop hailo-vlm.service
  sudo systemctl start hailo-ollama.service
  ```

Check your firmware's multi-context support:

```bash
hailortcli fw-control identify | grep -i "multi.context\|multi.process"
```

---

## Service Startup Order Note

All three services take time to initialise (model loading):

| Service            | Approximate startup time |
|--------------------|--------------------------|
| hailo-whisper      | ~10–20 s                 |
| hailo-ollama + LLM | ~30–60 s                 |
| hailo-vlm          | ~20–40 s                 |
| piper-http         | ~5 s                     |

Even after the Whisplay chatbot display shows "Ready", the Hailo services may
still be loading. Wait ~60 seconds after boot before speaking.

---

## Quick Reference

| Component | Start | Stop | Status |
|-----------|-------|------|--------|
| Hailo Whisper ASR | `sudo systemctl start hailo-whisper` | `sudo systemctl stop hailo-whisper` | `sudo systemctl status hailo-whisper` |
| Hailo Ollama LLM | `sudo systemctl start hailo-ollama` | `sudo systemctl stop hailo-ollama` | `sudo systemctl status hailo-ollama` |
| Piper TTS | `sudo systemctl start piper-tts` | `sudo systemctl stop piper-tts` | `sudo systemctl status piper-tts` |
| Hailo VLM | `sudo systemctl start hailo-vlm` | `sudo systemctl stop hailo-vlm` | `sudo systemctl status hailo-vlm` |

View logs:

```bash
journalctl -u hailo-whisper -f
journalctl -u hailo-ollama -f
```

---

## Deploy to Device

A one-command deployment script is provided at [`scripts/deploy-aihat2.sh`](scripts/deploy-aihat2.sh).

From your development machine with this repository:

```bash
# Deploy project to Pi and install everything
bash scripts/deploy-aihat2.sh
```

The script will:
1. `rsync` the project to `pi@192.168.100.252:~/whisplay-ai-chatbot`
2. Run `npm install && npm run build` on the Pi
3. Copy `.env.template` → `.env` if `.env` doesn't already exist
4. Create/install all four systemd services (hailo-whisper, hailo-ollama, piper-tts, hailo-vlm)
5. Pull the default LLM model (`qwen2.5-instruct:1.5b`) via hailo-ollama

To only sync code without reinstalling services:
```bash
bash scripts/deploy-aihat2.sh --sync-only
```

---

## References

- [Raspberry Pi AI software](https://www.raspberrypi.com/documentation/computers/ai.html#software) — **start here** for driver install
- [Raspberry Pi AI HAT+ documentation](https://www.raspberrypi.com/documentation/accessories/ai-hat-plus.html)
- [hailo-apps repository](https://github.com/hailo-ai/hailo-apps)
- [Hailo GenAI Apps README](https://github.com/hailo-ai/hailo-apps/tree/main/hailo_apps/python/gen_ai_apps)
- [Hailo Voice Processing Module](https://github.com/hailo-ai/hailo-apps/blob/main/hailo_apps/python/gen_ai_apps/gen_ai_utils/voice_processing/README.md)
- [Hailo Ollama Guide](https://github.com/hailo-ai/hailo-apps/blob/main/hailo_apps/python/gen_ai_apps/hailo_ollama/README.md)
- [Hailo Developer Zone](https://hailo.ai/developer-zone/)
- [LLM8850 Integration (reference)](https://github.com/PiSugar/whisplay-ai-chatbot/wiki/LLM8850-Integration)
