#!/bin/bash

# get model name from /app/voice_name.txt
VOICE_NAME=$(cat /app/voice_name.txt)

echo "Starting Piper HTTP server with voice: $VOICE_NAME"

python3 -m piper.http_server -m $VOICE_NAME --port 8805