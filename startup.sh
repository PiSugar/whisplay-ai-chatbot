#!/bin/bash

# disable graphical interface
sudo systemctl set-default multi-user.target

# WORKING_DIR="/home/pi/whisplay-ai-chatbot"
echo "Setting up the chatbot service..."

sudo bash -c 'cat > /etc/systemd/system/chatbot.service <<EOF
[Unit]
Description=Chatbot Service
After=network.target sound.target
Wants=sound.target

[Service]
Type=simple
User=pi
Group=audio
SupplementaryGroups=audio

WorkingDirectory=/home/pi/whisplay-ai-chatbot
ExecStart=/bin/bash /home/pi/whisplay-ai-chatbot/run_chatbot.sh

# Environment variables (ALSA / mpg123 are very important)
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/home/pi/.local/bin
Environment=HOME=/home/pi
Environment=XDG_RUNTIME_DIR=/run/user/1000

# Make sure the service has access to audio devices
PrivateDevices=no

StandardOutput=append:/home/pi/whisplay-ai-chatbot/chatbot.log
StandardError=append:/home/pi/whisplay-ai-chatbot/chatbot.log

Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF'

echo "Chatbot service file created."
echo "Enabling and starting the chatbot service..."

sudo systemctl enable chatbot.service
sudo systemctl start chatbot.service