#!/bin/bash
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org}"

if [ ! -f .env ]; then
  echo "Please create a .env file with the necessary environment variables. Please refer to .env.template for guidance."
  exit 1
fi

source ~/.bashrc 2>/dev/null || true
source "$(dirname "${BASH_SOURCE[0]}")/scripts/with-node.sh"
whisplay_require_node || exit 1

if [ ! -f "use_npm" ]; then
  if command -v yarn >/dev/null 2>&1; then
    echo "Using yarn to build the project."
    if yarn --registry="$NPM_REGISTRY" && yarn build; then
      exit 0
    fi
    echo "WARNING: yarn failed. Falling back to npm."
  else
    echo "WARNING: yarn not found. Falling back to npm."
  fi
fi

echo "Using npm to build the project."
npm install --registry="$NPM_REGISTRY" && npm run build
