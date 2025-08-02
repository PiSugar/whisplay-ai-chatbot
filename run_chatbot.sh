#!/bin/bash
# Set working directory
export NVM_DIR="/home/pi/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
# Output current environment information (for debugging)
echo "===== Start time: $(date) =====" 
echo "Current user: $(whoami)" 
echo "Working directory: $(pwd)" 
echo "PATH: $PATH" 
echo "Python version: $(python3 --version)" 
echo "Node version: $(node --version)"
sleep 5
# Adjust volume
amixer -c 1 set Speaker 114
# Start the service
echo "Starting Node.js application..."
cd /home/pi/whisplay-ai-chatbot
yarn start
# Record end status
echo "===== Service ended: $(date) ====="
