#!/bin/bash

# WORKING_DIR="/home/pi/whisplay-ai-chatbot"
echo "Setting up the chatbot service..."

sudo bash -c 'cat > /etc/systemd/system/chatbot.service <<EOF
[Unit]
Description=Chatbot Service
After=network.target
[Service]
User=pi
WorkingDirectory=/home/pi/whisplay-ai-chatbot
ExecStart=bash /home/pi/whisplay-ai-chatbot/run_chatbot.sh
StandardOutput=append:/home/pi/whisplay-ai-chatbot/chatbot.log
StandardError=append:/home/pi/whisplay-ai-chatbot/chatbot.log

[Install]
WantedBy=multi-user.target
EOF'

sudo systemctl enable chatbot.service
sudo systemctl start chatbot.service
