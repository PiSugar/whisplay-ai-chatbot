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

  systemctl status "$SERVICE_NAME" --no-pager
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

