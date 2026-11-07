#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="${XDG_DESKTOP_DIR:-}"

if [[ -z "$DESKTOP_DIR" ]] && command -v xdg-user-dir >/dev/null 2>&1; then
    DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
fi
DESKTOP_DIR="${DESKTOP_DIR:-$HOME/Desktop}"

SHORTCUT="$DESKTOP_DIR/whisplay-ai-chatbot.desktop"
mkdir -p "$DESKTOP_DIR"

cat >"$SHORTCUT" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Whisplay AI Chatbot
Name[zh_CN]=Whisplay AI 聊天机器人
Comment=Launch Whisplay AI Chatbot on the Hat Plus display
Comment[zh_CN]=在 Whisplay Hat Plus 屏幕上启动 AI 聊天机器人
Exec=$PROJECT_DIR/scripts/launch-hat-plus-app.sh
Icon=$PROJECT_DIR/web/whisplay-hat-plus/img/logo.png
Path=$PROJECT_DIR
Terminal=false
Categories=Utility;AudioVideo;
StartupNotify=true
EOF

chmod 755 "$SHORTCUT"
if command -v gio >/dev/null 2>&1; then
    gio set "$SHORTCUT" metadata::trusted true >/dev/null 2>&1 || true
fi

printf 'Installed desktop shortcut: %s\n' "$SHORTCUT"
