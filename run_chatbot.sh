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

# Output current environment information (for debugging)
echo "===== Start time: $(date) =====" 
echo "Current user: $(whoami)" 
echo "Working directory: $(pwd)" 
echo "PATH: $PATH" 
echo "Python version: $(python3 --version)" 
echo "Node version: $(node --version)"
sleep 5
# Adjust volume
amixer -c $card_index set Speaker 114
# Start the service
echo "Starting Node.js application..."
cd /home/pi/whisplay-ai-chatbot
SOUND_CARD_INDEX=$card_index yarn start
# Record end status
echo "===== Service ended: $(date) ====="
