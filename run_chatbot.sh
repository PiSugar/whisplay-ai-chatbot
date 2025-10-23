#!/bin/bash
# Set working directory
export NVM_DIR="/home/pi/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

SOUND_CARD_INDEX=1
# if Raspberry Pi 4 or 5, set SOUND_CARD_INDEX=2
if grep -q "Raspberry Pi 4" /proc/device-tree/model || grep -q "Raspberry Pi 5" /proc/device-tree/model; then
  SOUND_CARD_INDEX=2
fi
# Output current environment information (for debugging)
echo "===== Start time: $(date) =====" 
echo "Current user: $(whoami)" 
echo "Working directory: $(pwd)" 
echo "PATH: $PATH" 
echo "Python version: $(python3 --version)" 
echo "Node version: $(node --version)"
sleep 5
# Adjust volume
amixer -c $SOUND_CARD_INDEX set Speaker 114
# Start the service
echo "Starting Node.js application..."
cd /home/pi/whisplay-ai-chatbot
SOUND_CARD_INDEX=$SOUND_CARD_INDEX yarn start
# Record end status
echo "===== Service ended: $(date) ====="
