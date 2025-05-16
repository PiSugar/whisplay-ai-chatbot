#!/bin/bash

# WORKING_DIR="/home/pi/echoview-ai-chatbot"

sudo bash -c 'cat > /etc/systemd/system/chatbot.service <<EOF
[Unit]
Description=Chatbot Service
After=network.target
[Service]
User=pi
WorkingDirectory=/home/pi/echoview-ai-chatbot
ExecStart=bash /home/pi/echoview-ai-chatbot/run_chatbot.sh
StandardOutput=append:/home/pi/echoview-ai-chatbot/chatbot.log
StandardError=append:/home/pi/echoview-ai-chatbot/chatbot.log

[Install]
WantedBy=multi-user.target
EOF'
