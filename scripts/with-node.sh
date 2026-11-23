#!/usr/bin/env bash

WHISPLAY_NODE_MAJOR=22

whisplay_node_is_current() {
    local version major
    version=$(node --version 2>/dev/null) || return 1
    if [[ "$version" =~ ^v([0-9]+)\. ]]; then
        major=${BASH_REMATCH[1]}
        (( major >= WHISPLAY_NODE_MAJOR ))
    else
        return 1
    fi
}

whisplay_load_nvm() {
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    [ -s "$NVM_DIR/nvm.sh" ] || return 1
    source "$NVM_DIR/nvm.sh" --no-use
}

whisplay_select_node() {
    local node_bin
    if whisplay_node_is_current; then
        return 0
    fi
    if whisplay_load_nvm; then
        node_bin=$(nvm which "$WHISPLAY_NODE_MAJOR" 2>/dev/null) || node_bin=""
        if [ -x "$node_bin" ] && PATH="${node_bin%/*}:$PATH" whisplay_node_is_current; then
            export PATH="${node_bin%/*}:$PATH"
            return 0
        fi
    fi
    return 1
}

whisplay_require_node() {
    if ! whisplay_select_node; then
        printf 'Node.js %s or later is required. Run whisplay update or bash install_dependencies.sh.\n' \
            "$WHISPLAY_NODE_MAJOR" >&2
        return 1
    fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    # An update started by the old CLI may still invoke npm or Yarn under Node 20.
    whisplay_require_node || exit 1
    exec "$@"
fi
