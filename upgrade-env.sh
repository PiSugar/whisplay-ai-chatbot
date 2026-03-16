#!/bin/bash

# if file use_npm exists and is true, use npm
if [ -f "use_npm" ]; then
  use_npm=true
else
  use_npm=false
fi

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# check if .env file exists
if [ ! -f .env ]; then
    echo "Please create a .env file with the necessary environment variables. Please refer to .env.template for guidance."
    exit 1
fi

source ~/.bashrc

if [ "$use_npm" = true ]; then
  echo "Using npm to upgrade the env."
  npm run upgrade-env
else
  if ! command -v yarn >/dev/null 2>&1; then
    echo "WARNING: yarn not found. Falling back to npm."
    use_npm=true
  fi

  if [ "$use_npm" = true ]; then
    echo "Using npm to upgrade the env."
    npm run upgrade-env
  else
    echo "Using yarn to upgrade the env."
    if ! yarn upgrade-env; then
      echo "WARNING: yarn failed. Falling back to npm."
      npm run upgrade-env
    fi
  fi
fi
