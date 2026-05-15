#!/bin/bash

# if graphical interface is enabled, ask user whether to disable graphical interface
if [ "$(systemctl get-default)" == "graphical.target" ]; then
    echo "Graphical interface is currently enabled."
    read -p "Disabling graphical interface is recommended for a headless setup. Do you want to disable the graphical interface? (y/n) " disable_gui
    if [[ "$disable_gui" == "y" ]]; then
        echo "Disabling graphical interface..."
        sudo systemctl set-default multi-user.target
        echo "Graphical interface disabled. You can re-enable it later with 'sudo systemctl set-default graphical.target'."
    else
        echo "Keeping graphical interface enabled."
    fi
else
    echo "Graphical interface is currently disabled."
fi

# Get user info
TARGET_USER=$(whoami)
USER_HOME=$HOME
TARGET_UID=$(id -u $TARGET_USER)

# Make sure we do not return roon (in case user called the script with sudo)
if [ "$TARGET_USER" == "root" ]; then
    echo "Error: Please run this script as your normal user (WITHOUT sudo)."
    echo "The script will ask for sudo permissions only when writing the service file."
    exit 1
fi

echo "----------------------------------------"
echo "Detected User: $TARGET_USER"
echo "Detected Home: $USER_HOME"
echo "Detected UID:  $TARGET_UID"

# Find Node bin
NODE_BIN=$(which node)

if [ -z "$NODE_BIN" ]; then
    echo "Error: Could not find 'node'. Make sure you can run 'node -v' in this terminal."
    exit 1
fi

NODE_FOLDER=$(dirname $NODE_BIN)
echo "Found Node at: $NODE_FOLDER"
echo "----------------------------------------"

if command -v systemctl >/dev/null 2>&1; then
    if systemctl list-unit-files | grep -q '^whisplay-daemon\.service'; then
        echo "Detected whisplay-daemon.service on this system."
        echo "When whisplay-daemon is present, whisplay-ai-chatbot should be managed by the daemon instead of installing chatbot.service."
        echo "Please stop/disable the daemon service first if you really want the legacy standalone chatbot.service mode:"
        echo "  sudo systemctl stop whisplay-daemon.service"
        echo "  sudo systemctl disable whisplay-daemon.service"
        exit 1
    fi
fi

# Create the service file
echo "Creating systemd service file..."
sudo tee /etc/systemd/system/chatbot.service > /dev/null <<EOF
[Unit]
Description=Chatbot Service
After=network.target sound.target
Wants=sound.target

[Service]
Type=simple
User=$TARGET_USER
Group=audio
SupplementaryGroups=audio video gpio

# Use the dynamic Home Directory
WorkingDirectory=$USER_HOME/whisplay-ai-chatbot
ExecStart=/bin/bash $USER_HOME/whisplay-ai-chatbot/run_chatbot.sh

# Inject the dynamic Node path and dynamic User ID
Environment=PATH=$NODE_FOLDER:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin
Environment=HOME=$USER_HOME
Environment=XDG_RUNTIME_DIR=/run/user/$TARGET_UID
Environment=NODE_ENV=production

# Audio permissions
PrivateDevices=no

# Logs
StandardOutput=append:$USER_HOME/whisplay-ai-chatbot/chatbot.log
StandardError=append:$USER_HOME/whisplay-ai-chatbot/chatbot.log

Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

# start the service
echo "Service file created. Reloading Systemd..."
sudo systemctl daemon-reload
sudo systemctl enable chatbot.service
sudo systemctl restart chatbot.service

echo "Done! Chatbot is starting..."
echo "Checking status..."
sleep 2
sudo systemctl status chatbot --no-pager
