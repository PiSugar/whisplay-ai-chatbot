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

# Find the sound card index for wm8960soundcard (Linux only)
card_index=""
audio_supported=false
if [ "$is_linux" = true ] && [ -r "/proc/asound/cards" ] && command -v amixer >/dev/null 2>&1; then
  card_index=$(awk '/wm8960soundcard/ {print $1}' /proc/asound/cards | head -n1)
  # Default to 1 if not found
  if [ -z "$card_index" ]; then
    card_index=1
  fi
  audio_supported=true
  echo "Using sound card index: $card_index"
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
sleep 5

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
initial_volume_level=114
serve_ollama=false
if [ -f ".env" ]; then
  # Load only SERVE_OLLAMA from .env (ignore comments/other vars)
  SERVE_OLLAMA=$(get_env_value "SERVE_OLLAMA")
  [ -n "$SERVE_OLLAMA" ] && export SERVE_OLLAMA
  
  CUSTOM_FONT_PATH=$(get_env_value "CUSTOM_FONT_PATH")
  [ -n "$CUSTOM_FONT_PATH" ] && export CUSTOM_FONT_PATH

  INITIAL_VOLUME_LEVEL=$(get_env_value "INITIAL_VOLUME_LEVEL")
  [ -n "$INITIAL_VOLUME_LEVEL" ] && export INITIAL_VOLUME_LEVEL

  WHISPER_MODEL_SIZE=$(get_env_value "WHISPER_MODEL_SIZE")
  [ -n "$WHISPER_MODEL_SIZE" ] && export WHISPER_MODEL_SIZE

  FASTER_WHISPER_MODEL_SIZE=$(get_env_value "FASTER_WHISPER_MODEL_SIZE")
  [ -n "$FASTER_WHISPER_MODEL_SIZE" ] && export FASTER_WHISPER_MODEL_SIZE

  echo ".env variables loaded."

  # check if SERVE_OLLAMA is set to true
  if [ "$SERVE_OLLAMA" = "true" ]; then
    serve_ollama=true
  fi

  if [ -n "$INITIAL_VOLUME_LEVEL" ]; then
    initial_volume_level=$INITIAL_VOLUME_LEVEL
  fi
else
  echo ".env file not found, please create one based on .env.template."
  exit 1
fi

# Adjust initial volume (Linux only)
if [ "$audio_supported" = true ]; then
  amixer -c $card_index set Speaker $initial_volume_level
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

if [ "$use_npm" = true ]; then
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
