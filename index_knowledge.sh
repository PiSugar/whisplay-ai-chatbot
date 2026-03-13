#!/bin/bash

# if file use_npm exists and is true, use npm
if [ -f "use_npm" ]; then
  use_npm=true
else
  use_npm=false
fi

source ~/.bashrc

if [ "$use_npm" = true ]; then
  echo "Using npm to index the knowledge."
  npm run index-knowledge
else
  if ! command -v yarn >/dev/null 2>&1; then
    echo "WARNING: yarn not found. Falling back to npm."
    use_npm=true
  fi

  if [ "$use_npm" = true ]; then
    echo "Using npm to index the knowledge."
    npm run index-knowledge
  else
    echo "Using yarn to index the knowledge."
    if ! yarn run index-knowledge; then
      echo "WARNING: yarn failed. Falling back to npm."
      npm run index-knowledge
    fi
  fi
fi