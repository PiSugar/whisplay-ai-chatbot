#!/usr/bin/env bash
# ============================================================
# cli/commands.sh — Project-level commands
#   update, index-knowledge, upgrade-env, help, version
# ============================================================

# ── update ───────────────────────────────────────────────────

cmd_update() {
  require_cmd git

  _bold "Updating whisplay-ai-chatbot..."
  cd "$PROJECT_ROOT"

  _bold "[1/3] Pulling latest code..."
  git pull --ff-only

  _bold "[2/3] Installing dependencies..."
  source ~/.bashrc 2>/dev/null || true
  bash "$PROJECT_ROOT/install_dependencies.sh"

  _bold "[3/3] Building project..."
  pkg_run build

  _green "✅ Project updated successfully!"
  echo ""
  _dim "Tip: Run 'whisplay upgrade-env' if new environment variables were added."
  echo ""
}

# ── index-knowledge ──────────────────────────────────────────

cmd_index_knowledge() {
  _bold "Indexing knowledge base..."
  cd "$PROJECT_ROOT"
  source ~/.bashrc 2>/dev/null || true
  pkg_run index-knowledge
  _green "✅ Knowledge base indexed."
}

# ── upgrade-env ──────────────────────────────────────────────

cmd_upgrade_env() {
  cd "$PROJECT_ROOT"

  if [ ! -f .env ]; then
    _red "Error: .env file not found."
    echo "Please create a .env file first. Refer to .env.template for guidance."
    exit 1
  fi

  _bold "Upgrading .env to latest template..."
  source ~/.bashrc 2>/dev/null || true
  pkg_run upgrade-env
  _green "✅ .env file upgraded."
}

# ── help ─────────────────────────────────────────────────────

cmd_help() {
  _bold "whisplay v${VERSION} — Whisplay AI Chatbot CLI"
  echo ""
  echo "Usage: whisplay <command> [options]"
  echo ""
  echo "Commands:"
  echo "  plugin create              Create a new plugin from template"
  echo "  plugin install <url>       Install a plugin from GitHub"
  echo "  plugin remove  <name>      Remove an installed plugin"
  echo "  plugin update  <name>      Update a plugin (or --all)"
  echo "  plugin list                List installed plugins"
  echo "  service install            Install & register systemd service"
  echo "  service uninstall          Stop, disable and remove systemd service"
  echo "  service enable|disable     Enable or disable auto-start on boot"
  echo "  service start|stop|restart Control the running service"
  echo "  service status             Show service status"
  echo "  update                     Pull latest code, install deps & build"
  echo "  index-knowledge            Index the knowledge base"
  echo "  upgrade-env                Upgrade .env to latest template"
  echo "  version                    Show version"
  echo "  help                       Show this help message"
  echo ""
  echo "Examples:"
  echo "  whisplay plugin install https://github.com/user/whisplay-plugin-azure-tts.git"
  echo "  whisplay plugin create"
  echo "  whisplay update"
  echo "  whisplay index-knowledge"
  echo ""
}

# ── version ──────────────────────────────────────────────────

cmd_version() {
  echo "whisplay v${VERSION}"
}
