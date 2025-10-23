#!/bin/bash
# Set working directory
export NVM_DIR="/home/pi/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# Find the sound card index for wm8960soundcard
card_index=$(awk '/wm8960soundcard/ {print $1}' /proc/asound/cards | head -n1)
# Default to 1 if not found
if [ -z "$card_index" ]; then
  card_index=1
fi
echo "Using sound card index: $card_index"

use_ollama=false
# if use_ollama file exists, set environment variable
if [ -f "use_ollama" ]; then
  use_ollama=true
fi

if [ "$use_ollama" = true ]; then
  ollama serve &
fi

# Output current environment information (for debugging)
echo "===== Start time: $(date) =====" 
echo "Current user: $(whoami)" 
echo "Working directory: $(pwd)" 
working_dir=$(pwd)
echo "PATH: $PATH" 
echo "Python version: $(python3 --version)" 
echo "Node version: $(node --version)"
sleep 5
# Adjust volume
amixer -c $card_index set Speaker 114
# Start the service
echo "Starting Node.js application..."
cd $working_dir

SOUND_CARD_INDEX=$card_index yarn start

if [ "$use_ollama" = true ]; then
  echo "Stopping Ollama server..."
  pkill ollama
fi

# Record end status
echo "===== Service ended: $(date) ====="
