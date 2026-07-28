#!/usr/bin/env bash
# ============================================================
# cli/service.sh — Manage the chatbot systemd service
# ============================================================

SERVICE_NAME="chatbot.service"

cmd_service() {
  local subcmd="${1:-help}"
  shift || true

  case "$subcmd" in
    install)  _service_install ;;
    uninstall) _service_uninstall ;;
    enable)   _service_ctl enable ;;
    disable)  _service_ctl disable ;;
    start)    _service_ctl start ;;
    stop)     _service_ctl stop ;;
    restart)  _service_ctl restart ;;
    status)   _service_status ;;
    help|--help|-h) _service_help ;;
    *)
      _red "Unknown service sub-command: ${subcmd}"
      echo ""
      _service_help
      exit 1
      ;;
  esac
}

_service_install() {
  require_cmd bash

  local setup_script="${PROJECT_ROOT}/startup.sh"
  if [ ! -f "$setup_script" ]; then
    _red "Error: startup.sh not found at ${PROJECT_ROOT}"
    exit 1
  fi

  _bold "Installing chatbot service (startup.sh)..."
  cd "$PROJECT_ROOT"
  bash "$setup_script"
}

_service_uninstall() {
  require_cmd sudo
  require_cmd systemctl

  _bold "Uninstalling ${SERVICE_NAME}..."

  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    _bold "Stopping ${SERVICE_NAME}..."
    sudo systemctl stop "$SERVICE_NAME"
  fi

  if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
    _bold "Disabling ${SERVICE_NAME}..."
    sudo systemctl disable "$SERVICE_NAME"
  fi

  local unit_file="/etc/systemd/system/${SERVICE_NAME}"
  if [ -f "$unit_file" ]; then
    sudo rm -f "$unit_file"
    _bold "Removed ${unit_file}"
  fi

  sudo systemctl daemon-reload
  _green "✅ ${SERVICE_NAME} uninstalled."
}

_service_ctl() {
  local action="$1"
  require_cmd sudo
  require_cmd systemctl

  if _daemon_service_mode_available && [[ "$action" =~ ^(start|stop|restart)$ ]]; then
    _service_ctl_daemon_app "$action"
    return
  fi

  _bold "${action^}ing ${SERVICE_NAME}..."
  sudo systemctl "$action" "$SERVICE_NAME"

  case "$action" in
    enable)  _green "✅ ${SERVICE_NAME} enabled (will start on boot)." ;;
    disable) _yellow "⚠️  ${SERVICE_NAME} disabled (will not start on boot)." ;;
    start)   _green "✅ ${SERVICE_NAME} started." ;;
    stop)    _yellow "⚠️  ${SERVICE_NAME} stopped." ;;
    restart) _green "✅ ${SERVICE_NAME} restarted." ;;
  esac
}

_service_status() {
  require_cmd systemctl

  if _daemon_service_mode_available; then
    _service_daemon_app_status
    return
  fi

  systemctl status "$SERVICE_NAME" --no-pager
}

_daemon_service_mode_available() {
  [ -S /tmp/whisplay-daemon.sock ] &&
    command -v node &>/dev/null &&
    systemctl is-active --quiet whisplay-daemon.service 2>/dev/null
}

_daemon_request() {
  local cmd="$1"
  local payload="${2:-}"
  [ -n "$payload" ] || payload="{}"
  DAEMON_CMD="$cmd" DAEMON_PAYLOAD="$payload" node -e '
const net = require("net");
const cmd = process.env.DAEMON_CMD;
const payload = JSON.parse(process.env.DAEMON_PAYLOAD || "{}");
const socketPath = "/tmp/whisplay-daemon.sock";
const client = net.createConnection(socketPath);
let buffer = "";
client.setTimeout(3000);
client.on("connect", () => {
  client.write(JSON.stringify({ version: 1, cmd, payload }) + "\n");
});
client.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  const idx = buffer.indexOf("\n");
  if (idx < 0) return;
  const line = buffer.slice(0, idx).trim();
  client.end();
  const response = JSON.parse(line);
  if (!response.ok) {
    console.error(response.error || "daemon request failed");
    process.exit(1);
  }
  console.log(JSON.stringify(response.payload || {}));
});
client.on("timeout", () => {
  client.destroy();
  console.error("daemon request timed out");
  process.exit(1);
});
client.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
'
}

_service_ctl_daemon_app() {
  local action="$1"
  local app_id="whisplay-ai-chatbot"

  case "$action" in
    start)
      _bold "Starting ${app_id} via whisplay-daemon..."
      _daemon_request app.launch "{\"app_id\":\"${app_id}\"}" >/dev/null
      _green "✅ ${app_id} launch requested."
      ;;
    stop)
      _bold "Stopping ${app_id} via whisplay-daemon..."
      _daemon_request app.exit.request "{\"app_id\":\"${app_id}\"}" >/dev/null
      _yellow "⚠️  ${app_id} exit requested."
      ;;
    restart)
      _bold "Restarting ${app_id} via whisplay-daemon..."
      _daemon_request app.exit.request "{\"app_id\":\"${app_id}\"}" >/dev/null || true
      sleep 2
      _daemon_request app.launch "{\"app_id\":\"${app_id}\"}" >/dev/null
      _green "✅ ${app_id} restart requested."
      ;;
  esac
}

_service_daemon_app_status() {
  _bold "whisplay-daemon is active. Showing daemon app status for AI Chatbot:"
  _daemon_request app.list '{}' | node -e '
const fs = require("fs");
const input = fs.readFileSync(0, "utf8").trim();
const payload = input ? JSON.parse(input) : {};
const apps = payload.apps || [];
const app = apps.find((item) => item.app_id === "whisplay-ai-chatbot");
if (!app) {
  console.log("AI Chatbot is not registered with whisplay-daemon.");
  process.exit(1);
}
console.log(`running=${app.running} foreground=${app.foreground} selected=${app.selected}`);
'
}

_service_help() {
  echo "Usage: whisplay service <sub-command>"
  echo ""
  echo "Sub-commands:"
  echo "  install   Install & register the chatbot systemd service (runs startup.sh)"
  echo "  uninstall Stop, disable and remove the chatbot systemd service"
  echo "  enable    Enable auto-start on boot"
  echo "  disable   Disable auto-start on boot"
  echo "  start     Start the service"
  echo "  stop      Stop the service"
  echo "  restart   Restart the service"
  echo "  status    Show current service status"
  echo ""
}
