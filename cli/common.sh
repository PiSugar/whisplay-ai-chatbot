#!/usr/bin/env bash
# ============================================================
# cli/common.sh — Shared helpers for the Whisplay CLI
# ============================================================

VERSION="1.0.0"

# ── Resolve project root ─────────────────────────────────────
# Walk up from the caller script's real location to find the project root.
# Expects to be sourced from bin/whisplay which lives in <project>/bin/.
resolve_project_root() {
  local source="${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}"
  # Resolve symlinks
  while [ -L "$source" ]; do
    local dir
    dir="$(cd -P "$(dirname "$source")" && pwd)"
    source="$(readlink "$source")"
    [[ "$source" != /* ]] && source="$dir/$source"
  done
  local script_dir
  script_dir="$(cd -P "$(dirname "$source")" && pwd)"

  # Try <script_dir>/.. (bin/whisplay → project root)
  local root="$(cd "$script_dir/.." && pwd)"
  if [ -f "$root/package.json" ]; then
    echo "$root"
    return
  fi

  # Try <script_dir>/../.. (cli/common.sh → project root)
  root="$(cd "$script_dir/../.." 2>/dev/null && pwd)"
  if [ -f "$root/package.json" ]; then
    echo "$root"
    return
  fi

  # Fallback: current working directory
  if [ -f "$PWD/package.json" ] && grep -q '"ai-node"' "$PWD/package.json" 2>/dev/null; then
    echo "$PWD"
    return
  fi

  echo ""
}

# ── Terminal colors ──────────────────────────────────────────

_green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
_yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
_red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
_bold()   { printf '\033[1m%s\033[0m\n' "$*"; }
_dim()    { printf '\033[2m%s\033[0m\n' "$*"; }

# ── Package manager helpers ──────────────────────────────────

use_npm() {
  [ -f "${PROJECT_ROOT}/use_npm" ]
}

pkg_run() {
  if use_npm; then
    npm run "$@"
  else
    yarn run "$@"
  fi
}

# ── Utility functions ────────────────────────────────────────

ensure_plugins_dir() {
  if [ ! -d "$PLUGINS_DIR" ]; then
    mkdir -p "$PLUGINS_DIR"
  fi
}

require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    _red "Error: '$1' is required but not found. Please install it first."
    exit 1
  fi
}

# Derive directory name from a GitHub URL
# e.g. https://github.com/user/whisplay-plugin-foo.git → whisplay-plugin-foo
repo_to_dirname() {
  local url="$1"
  local base
  base="$(basename "$url")"
  echo "${base%.git}"
}
