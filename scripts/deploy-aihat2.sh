#!/usr/bin/env bash
# deploy-aihat2.sh — Deploy Whisplay to a Raspberry Pi AI HAT+ 2 (Hailo-10H)
# Usage:
#   bash scripts/deploy-aihat2.sh           (full install)
#   bash scripts/deploy-aihat2.sh --sync-only  (rsync code only, no service reinstall)
# ============================================================
set -euo pipefail

# ---- Configuration -----------------------------------------
PI_HOST="${PI_HOST:-pi@192.168.100.252}"
REMOTE_DIR="${REMOTE_DIR:-/home/pi/whisplay-ai-chatbot}"
HAILO_APPS_DIR="/home/pi/hailo-apps"
PIPER_DIR="/home/pi/piper"
PIPER_VOICE="${PIPER_VOICE:-en_US-amy-medium}"
LLM_MODEL="${LLM_MODEL:-qwen2.5-instruct:1.5b}"
SYNC_ONLY=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# ---- End Configuration -------------------------------------

for arg in "$@"; do
  case "$arg" in
    --sync-only) SYNC_ONLY=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

log()  { echo "[deploy] $*"; }
ssh_run() { ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "${PI_HOST}" "$@"; }

# ─── Step 1: Sync project files ─────────────────────────────
log "Syncing project to ${PI_HOST}:${REMOTE_DIR} …"
rsync -az --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.env' \
  "${PROJECT_ROOT}/" "${PI_HOST}:${REMOTE_DIR}/"
log "Sync complete."

# ─── Step 2: Build on device ────────────────────────────────
log "Running npm install + build on device …"
ssh_run bash -c "
  set -e
  cd '${REMOTE_DIR}'
  if ! command -v node &>/dev/null; then
    echo 'ERROR: Node.js not found on device. Install Node.js 20+ first.' >&2
    exit 1
  fi
  npm install --prefer-offline
  npm run build
"

# ─── Step 3: Bootstrap .env if missing ──────────────────────
log "Configuring .env for AI HAT+ 2 …"
ssh_run bash -c "
  set -e
  cd '${REMOTE_DIR}'
  if [ ! -f .env ]; then
    cp .env.template .env
    # Apply AI HAT+ 2 defaults
    sed -i 's/^ASR_SERVER=.*/ASR_SERVER=hailowhisper/' .env
    sed -i 's/^TTS_SERVER=.*/TTS_SERVER=piper-http/' .env
    sed -i 's/^LLM_API=.*/LLM_API=ollama/' .env
    # Point ollama at hailo-ollama on port 8000
    grep -q '^OLLAMA_BASE_URL=' .env || echo 'OLLAMA_BASE_URL=http://localhost:8000' >> .env
    grep -q '^OLLAMA_MODEL='    .env || echo 'OLLAMA_MODEL=${LLM_MODEL}' >> .env
    echo '[deploy] .env created from template with AI HAT+ 2 defaults.'
  else
    echo '[deploy] .env already exists, leaving it unchanged.'
  fi
"

if [ "${SYNC_ONLY}" = true ]; then
  log "Sync-only mode — skipping service install. Done."
  exit 0
fi

# ─── Step 4: Install/verify hailo-h10-all ───────────────────
log "Checking Hailo driver …"
ssh_run bash -c "
  set -e
  if dpkg -l hailo-h10-all 2>/dev/null | grep -q '^ii'; then
    echo 'hailo-h10-all already installed.'
  else
    echo 'Installing hailo-h10-all (removes hailo-all if present) …'
    sudo apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y hailo-h10-all
  fi

  # Blacklist conflicting Hailo-8 built-in module if not already done
  if [ ! -f /etc/modprobe.d/blacklist-hailo-h8.conf ]; then
    echo 'Blacklisting old hailo_pci module to prevent probe conflict …'
    echo 'blacklist hailo_pci' | sudo tee /etc/modprobe.d/blacklist-hailo-h8.conf
    echo 'install hailo_pci /bin/true' | sudo tee -a /etc/modprobe.d/blacklist-hailo-h8.conf
    sudo update-initramfs -u
    echo ''
    echo '================================================================'
    echo ' Kernel module blacklist applied. A REBOOT is required.'
    echo ' Please reboot the Pi and re-run this script.'
    echo '================================================================'
    exit 1
  fi

  if [ ! -c /dev/hailo0 ]; then
    echo 'ERROR: /dev/hailo0 not found. Please reboot the Pi first.' >&2
    exit 1
  fi

  arch=\$(hailortcli fw-control identify 2>/dev/null | grep -i 'device architecture' || true)
  echo \"  Hailo driver OK. \${arch}\"
"

# ─── Step 5: Install hailo-apps + GenAI dependencies ────────
log "Ensuring hailo-apps GenAI stack is installed …"
ssh_run bash -c "
  set -e
  if [ ! -d '${HAILO_APPS_DIR}' ]; then
    echo 'Cloning hailo-apps …'
    git clone https://github.com/hailo-ai/hailo-apps.git '${HAILO_APPS_DIR}'
    cd '${HAILO_APPS_DIR}'
    sudo ./install.sh
  else
    echo 'hailo-apps directory found, assuming already installed.'
  fi

  # Ensure gen-ai extras are installed
  source '${HAILO_APPS_DIR}/setup_env.sh'
  pip install -q -e '.[gen-ai]' || true  # gen-ai extras; non-fatal if already installed
"

# ─── Step 6: Download Whisper model ─────────────────────────
log "Downloading Whisper ASR model (hailo10h) …"
ssh_run bash -c "
  source '${HAILO_APPS_DIR}/setup_env.sh'
  hailo-download-resources --group whisper_chat --arch hailo10h || true
"

# ─── Step 7: Install Piper TTS (system pip, no hailo-apps venv) ───
# Piper runs on Pi CPU only. Whisplay manages the piper process automatically.
# See: https://github.com/PiSugar/whisplay-ai-chatbot/wiki/TTS-%E2%80%90-piper%E2%80%90http
log "Installing piper-tts and downloading voice model: ${PIPER_VOICE} …"
ssh_run bash -c "
  set -e
  # Install piper-tts 1.3.0 system-wide (1.4.0 has issues)
  if ! python3 -c 'import piper' 2>/dev/null; then
    echo 'Installing piper-tts==1.3.0 …'
    pip install piper-tts==1.3.0 --break-system-packages
    pip install 'piper-tts[http]' --break-system-packages
  else
    echo 'piper already installed.'
  fi

  # Download voice model to ~/piper/ (whisplay default location)
  mkdir -p '${PIPER_DIR}'
  if [ ! -f '${PIPER_DIR}/${PIPER_VOICE}.onnx' ]; then
    echo 'Downloading piper voice model ${PIPER_VOICE} …'
    cd '${PIPER_DIR}'
    python3 -m piper.download_voices '${PIPER_VOICE}'
  else
    echo 'Piper model ${PIPER_VOICE} already present.'
  fi
"

# ─── Step 8: Download + install Hailo GenAI Model Zoo ───────
log "Checking hailo-ollama …"
ssh_run bash -c "
  if command -v hailo-ollama &>/dev/null; then
    echo 'hailo-ollama already installed.'
  else
    echo 'Downloading Hailo GenAI Model Zoo deb …'
    curl -fsSL -o /tmp/hailo_gen_ai_model_zoo.deb \
      'https://dev-public.hailo.ai/2025_12/Hailo10/hailo_gen_ai_model_zoo_5.1.1_arm64.deb'
    sudo dpkg -i /tmp/hailo_gen_ai_model_zoo.deb
    rm /tmp/hailo_gen_ai_model_zoo.deb
    echo 'hailo-ollama installed.'
  fi
"

# ─── Step 9: Install systemd services ───────────────────────
log "Installing systemd services …"
VENV_PYTHON="${HAILO_APPS_DIR}/venv_hailo_apps/bin/python3"
WHISPER_SCRIPT="${REMOTE_DIR}/python/speech-service/hailo-whisper-host.py"

ssh_run bash -c "
  set -e
  VENV_PYTHON='${VENV_PYTHON}'
  WHISPER_SCRIPT='${WHISPER_SCRIPT}'
  HAILO_APPS_DIR='${HAILO_APPS_DIR}'
  PIPER_VOICE='${PIPER_VOICE}'
  VENV_BIN="${HAILO_APPS_DIR}/venv_hailo_apps/bin"

  # --- Hailo Whisper ASR ---
  cat > /tmp/hailo-whisper.service << EOF2
[Unit]
Description=Hailo Whisper ASR HTTP Service
After=network.target

[Service]
User=pi
Environment=PYTHONPATH=${HAILO_APPS_DIR}
Environment=PATH=${HAILO_APPS_DIR}/venv_hailo_apps/bin:/usr/local/bin:/usr/bin:/bin
WorkingDirectory=${HAILO_APPS_DIR}
ExecStart=\${VENV_PYTHON} \${WHISPER_SCRIPT} --port 8807
Restart=on-failure
StandardOutput=append:/home/pi/hailo-whisper.log
StandardError=append:/home/pi/hailo-whisper-err.log

[Install]
WantedBy=multi-user.target
EOF2
  sudo mv /tmp/hailo-whisper.service /etc/systemd/system/

  # --- Hailo Ollama LLM ---
  cat > /tmp/hailo-ollama.service << EOF2
[Unit]
Description=Hailo Ollama LLM Service
After=network.target

[Service]
User=pi
ExecStart=/usr/bin/hailo-ollama serve
Restart=on-failure
StandardOutput=append:/home/pi/hailo-ollama.log
StandardError=append:/home/pi/hailo-ollama-err.log

[Install]
WantedBy=multi-user.target
EOF2
  sudo mv /tmp/hailo-ollama.service /etc/systemd/system/

  sudo systemctl daemon-reload
  sudo systemctl enable hailo-whisper hailo-ollama
  sudo systemctl restart hailo-whisper hailo-ollama
  echo 'Services enabled and started. (Piper TTS is managed by Whisplay automatically.)'
"

# ─── Step 10: Pull LLM model via hailo-ollama API ───────────
# NOTE: hailo-ollama pull is done via REST API (not CLI), while the service is running.
# The CLI 'hailo-ollama pull' starts a new server and doesn't connect to the running one.
log "Pulling LLM model ${LLM_MODEL} via hailo-ollama API (may take several minutes — model is ~2.2 GB) …"
ssh_run bash -c "
  # Wait for hailo-ollama to become ready
  for i in \$(seq 1 20); do
    if curl -sf http://localhost:8000/api/tags &>/dev/null; then
      echo 'hailo-ollama is ready.'
      break
    fi
    echo 'Waiting for hailo-ollama … (\$i/20)'
    sleep 3
  done
  # Pull via REST API (streaming progress)
  curl --silent http://localhost:8000/api/pull \\
    -H 'Content-Type: application/json' \\
    -d '{ \"model\": \"${LLM_MODEL}\", \"stream\": true }' 2>&1 | tail -5 \\
    || echo 'WARN: pull failed — run manually: curl -s http://localhost:8000/api/pull -H Content-Type:application/json -d {\"model\":\"${LLM_MODEL}\"}'
"

# ─── Done ────────────────────────────────────────────────────
log ""
log "========================================================"
log " Deployment complete!"
log "========================================================"
log " SSH to the Pi and verify services:"
log "   ssh ${PI_HOST}"
log "   sudo systemctl status hailo-whisper hailo-ollama piper-tts"
log ""
log " Run Whisplay:"
log "   cd ${REMOTE_DIR} && npm start"
log ""
log " Or start with the built-in startup script:"
log "   bash ${REMOTE_DIR}/startup.sh"
log "========================================================"
