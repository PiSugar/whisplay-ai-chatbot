#!/bin/bash
# Set working directory and environment
os_name=$(uname -s 2>/dev/null || echo "unknown")
is_linux=false
is_darwin=false
is_windows=false
case "$os_name" in
  Linux*) is_linux=true ;;
  Darwin*) is_darwin=true ;;
  MINGW*|MSYS*|CYGWIN*) is_windows=true ;;
esac

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# Find the unified Whisplay sound card first; keep legacy names as fallback.
card_index=""
card_name=""
audio_supported=false
if [ "$is_linux" = true ] && [ -r "/proc/asound/cards" ] && command -v amixer >/dev/null 2>&1; then
  card_info=$(awk '/whisplaysound|wm8960soundcard|es8389soundcard/ {print $1 " " $2; exit}' /proc/asound/cards)
  if [ -n "$card_info" ]; then
    card_index=$(echo "$card_info" | awk '{print $1}')
    card_name=$(echo "$card_info" | awk '{print $2}' | tr -d '[]:')
    audio_supported=true
    echo "Using sound card: ${card_name:-unknown} (index ${card_index})"
  else
    echo "Whisplay sound card not found; using default audio devices."
  fi
else
  echo "Audio setup skipped for OS: $os_name"
fi

# Output current environment information (for debugging)
echo "===== Start time: $(date) =====" 
echo "Current user: $(whoami)" 
echo "Working directory: $(pwd)" 
working_dir=$(pwd)
echo "PATH: $PATH" 
if command -v python3 >/dev/null 2>&1; then
  echo "Python version: $(python3 --version)"
else
  echo "Python version: not found"
fi
if command -v node >/dev/null 2>&1; then
  echo "Node version: $(node --version)"
else
  echo "Node version: not found"
fi

# Start the service
echo "Starting Node.js application..."
cd $working_dir

get_env_value() {
  if grep -Eq "^[[:space:]]*$1[[:space:]]*=" .env; then
    val=$(grep -E "^[[:space:]]*$1[[:space:]]*=" .env | tail -n1 | cut -d'=' -f2-)
    # trim whitespace and surrounding quotes
    echo "$(echo "$val" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
  else
    echo ""
  fi
}

# load .env variables, exclude comments and empty lines
# check if .env file exists
initial_volume_percent=""
default_initial_volume_percent=80
serve_ollama=false
if [ -f ".env" ]; then
  # Load only SERVE_OLLAMA from .env (ignore comments/other vars)
  SERVE_OLLAMA=$(get_env_value "SERVE_OLLAMA")
  [ -n "$SERVE_OLLAMA" ] && export SERVE_OLLAMA
  
  CUSTOM_FONT_PATH=$(get_env_value "CUSTOM_FONT_PATH")
  [ -n "$CUSTOM_FONT_PATH" ] && export CUSTOM_FONT_PATH

  INITIAL_VOLUME_PERCENT=$(get_env_value "INITIAL_VOLUME_PERCENT")

  INITIAL_VOLUME_LEVEL=$(get_env_value "INITIAL_VOLUME_LEVEL")
  if [ -n "$INITIAL_VOLUME_LEVEL" ]; then
    echo "[Volume] INITIAL_VOLUME_LEVEL is deprecated and ignored. Please use INITIAL_VOLUME_PERCENT (0-100) instead."
  fi

  WHISPER_MODEL_SIZE=$(get_env_value "WHISPER_MODEL_SIZE")
  [ -n "$WHISPER_MODEL_SIZE" ] && export WHISPER_MODEL_SIZE

  FASTER_WHISPER_MODEL_SIZE=$(get_env_value "FASTER_WHISPER_MODEL_SIZE")
  [ -n "$FASTER_WHISPER_MODEL_SIZE" ] && export FASTER_WHISPER_MODEL_SIZE

  echo ".env variables loaded."

  # check if SERVE_OLLAMA is set to true
  if [ "$SERVE_OLLAMA" = "true" ]; then
    serve_ollama=true
  fi

  if [ -n "$INITIAL_VOLUME_PERCENT" ] && [ "$INITIAL_VOLUME_PERCENT" != "auto" ]; then
    initial_volume_percent=$INITIAL_VOLUME_PERCENT
  fi
else
  echo ".env file not found, please create one based on .env.template."
  exit 1
fi

# Adjust initial volume (Linux only). INITIAL_VOLUME_PERCENT is the percentage
# users see in alsamixer. The unified driver exposes a 0-100 speaker control;
# legacy WM8960 accepts percentages through amixer set Speaker.
if [ "$audio_supported" = true ]; then
  if [ -z "$initial_volume_percent" ]; then
    initial_volume_percent=$default_initial_volume_percent
  fi

  if [ "$card_name" = "whisplaysound" ]; then
    amixer -c "$card_name" cset name='speaker' "$initial_volume_percent" >/dev/null 2>&1 || true
  else
    amixer -c "$card_index" set Speaker "${initial_volume_percent}%" >/dev/null 2>&1 || true
  fi
fi

if [ -n "$card_name" ]; then
  export SOUND_CARD_NAME="$card_name"
  export SOUND_CARD_INDEX="$card_index"
  export ALSA_OUTPUT_DEVICE="${ALSA_OUTPUT_DEVICE:-hw:${card_name},0}"
fi

if [ "$serve_ollama" = true ]; then
  echo "Starting Ollama server..."
  export OLLAMA_KEEP_ALIVE=-1 # ensure Ollama server stays alive
  OLLAMA_HOST=0.0.0.0:11434 ollama serve &
fi

# if file use_npm exists and is true, use npm
if [ -f "use_npm" ]; then
  use_npm=true
else
  use_npm=false
fi

if [ -f "dist/index.js" ] && command -v node >/dev/null 2>&1; then
  echo "Starting compiled application directly..."
  if [ -n "$card_index" ]; then
    SOUND_CARD_INDEX=$card_index node dist/index.js
  else
    node dist/index.js
  fi
elif [ "$use_npm" = true ]; then
  echo "Using npm to start the application..."
  if [ -n "$card_index" ]; then
    SOUND_CARD_INDEX=$card_index npm start
  else
    npm start
  fi
else
  echo "Using yarn to start the application..."
  if [ -n "$card_index" ]; then
    SOUND_CARD_INDEX=$card_index yarn start
  else
    yarn start
  fi
fi

# After the service ends, perform cleanup
echo "Cleaning up after service..."

if [ "$serve_ollama" = true ]; then
  echo "Stopping Ollama server..."
  if command -v pkill >/dev/null 2>&1; then
    pkill ollama
  else
    echo "pkill not available; please stop ollama manually if needed."
  fi
fi

# Record end status
echo "===== Service ended: $(date) ====="
