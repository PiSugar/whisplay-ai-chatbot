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
  echo "Using yarn to index the knowledge."
  yarn run index-knowledge
fi