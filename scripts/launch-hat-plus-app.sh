#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$PROJECT_DIR/.hat-plus-app.pid"
LOG_FILE="$PROJECT_DIR/chatbot.log"

is_project_running() {
    local pid cwd
    while read -r pid; do
        [[ -n "$pid" ]] || continue
        cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
        if [[ "$cwd" == "$PROJECT_DIR" ]]; then
            return 0
        fi
    done < <(pgrep -u "$(id -u)" -f '(^|/)bash( |.*/)run_chatbot\.sh' || true)
    return 1
}

if is_project_running; then
    exit 0
fi

cd "$PROJECT_DIR"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

nohup setsid bash "$PROJECT_DIR/run_chatbot.sh" >>"$LOG_FILE" 2>&1 </dev/null &
launcher_pid=$!
printf '%s\n' "$launcher_pid" >"$PID_FILE"

