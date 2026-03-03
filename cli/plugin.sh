#!/usr/bin/env bash
# ============================================================
# cli/plugin.sh — Plugin install / remove / update / list
# ============================================================

# ── install ──────────────────────────────────────────────────

plugin_install() {
  local url="${1:-}"
  if [ -z "$url" ]; then
    _red "Usage: whisplay plugin install <github-url>"
    exit 1
  fi

  require_cmd git
  ensure_plugins_dir

  local dirname
  dirname="$(repo_to_dirname "$url")"
  local dest="${PLUGINS_DIR}/${dirname}"

  if [ -d "$dest" ]; then
    _yellow "Plugin '${dirname}' already exists at ${dest}"
    _yellow "To update, run: whisplay plugin update ${dirname}"
    exit 1
  fi

  _bold "Installing plugin from: ${url}"
  git clone --depth 1 "$url" "$dest"

  # Install dependencies if package.json exists
  if [ -f "${dest}/package.json" ]; then
    _bold "Installing dependencies for ${dirname}..."
    (cd "$dest" && npm install --production)
  fi

  # Run build if a build script is defined
  if [ -f "${dest}/package.json" ] && grep -q '"build"' "${dest}/package.json"; then
    _bold "Building ${dirname}..."
    (cd "$dest" && npm run build)
  fi

  _green "✅ Plugin '${dirname}' installed successfully!"
  echo ""
  _bold "Next steps:"
  echo "  1. Configure the plugin in your .env file"
  echo "  2. Restart the chatbot"
  echo ""
}

# ── remove ───────────────────────────────────────────────────

plugin_remove() {
  local name="${1:-}"
  if [ -z "$name" ]; then
    _red "Usage: whisplay plugin remove <plugin-name>"
    exit 1
  fi

  local dest="${PLUGINS_DIR}/${name}"
  if [ ! -d "$dest" ]; then
    _red "Plugin '${name}' not found in ${PLUGINS_DIR}"
    exit 1
  fi

  _bold "Removing plugin '${name}'..."
  rm -rf "$dest"
  _green "✅ Plugin '${name}' removed."
}

# ── update ───────────────────────────────────────────────────

_plugin_update_one() {
  local name="$1"
  local dest="${PLUGINS_DIR}/${name}"

  if [ ! -d "${dest}/.git" ]; then
    _yellow "Skipping '${name}': not a git repository"
    return
  fi

  _bold "Updating '${name}'..."
  (cd "$dest" && git pull --ff-only)

  if [ -f "${dest}/package.json" ]; then
    (cd "$dest" && npm install --production)
  fi

  if [ -f "${dest}/package.json" ] && grep -q '"build"' "${dest}/package.json"; then
    (cd "$dest" && npm run build)
  fi

  _green "✅ '${name}' updated."
}

plugin_update() {
  local name="${1:-}"
  if [ -z "$name" ]; then
    _red "Usage: whisplay plugin update <plugin-name>  or  whisplay plugin update --all"
    exit 1
  fi

  require_cmd git
  ensure_plugins_dir

  if [ "$name" = "--all" ]; then
    local found=0
    for dir in "${PLUGINS_DIR}"/*/; do
      [ -d "$dir" ] || continue
      _plugin_update_one "$(basename "$dir")"
      found=1
    done
    if [ "$found" -eq 0 ]; then
      _yellow "No plugins installed."
    fi
  else
    if [ ! -d "${PLUGINS_DIR}/${name}" ]; then
      _red "Plugin '${name}' not found."
      exit 1
    fi
    _plugin_update_one "$name"
  fi
}

# ── list ─────────────────────────────────────────────────────

plugin_list() {
  ensure_plugins_dir

  local count=0
  _bold "Installed plugins (${PLUGINS_DIR}):"
  echo ""

  for dir in "${PLUGINS_DIR}"/*/; do
    [ -d "$dir" ] || continue
    local name
    name="$(basename "$dir")"
    local version="—"
    local desc=""

    if [ -f "${dir}package.json" ]; then
      version="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "${dir}package.json" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/')" || true
      desc="$(grep -o '"description"[[:space:]]*:[[:space:]]*"[^"]*"' "${dir}package.json" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/')" || true
    fi

    printf "  %-35s  v%-10s  %s\n" "$name" "${version:-—}" "${desc}"
    count=$((count + 1))
  done

  echo ""
  if [ "$count" -eq 0 ]; then
    _yellow "  (no plugins installed)"
  else
    echo "  Total: ${count} plugin(s)"
  fi
  echo ""
}

# ── dispatcher ───────────────────────────────────────────────

cmd_plugin() {
  local subcmd="${1:-}"
  shift || true

  case "$subcmd" in
    install) plugin_install "$@" ;;
    remove)  plugin_remove  "$@" ;;
    update)  plugin_update  "$@" ;;
    create)  plugin_create "$@" ;;
    list)    plugin_list ;;
    *)
      echo "Usage: whisplay plugin <command>"
      echo ""
      echo "Commands:"
      echo "  create                 Create a new plugin from template"
      echo "  install <github-url>   Install a plugin from GitHub"
      echo "  remove  <plugin-name>  Remove an installed plugin"
      echo "  update  <name|--all>   Update plugin(s) via git pull"
      echo "  list                   List installed plugins"
      echo ""
      ;;
  esac
}
