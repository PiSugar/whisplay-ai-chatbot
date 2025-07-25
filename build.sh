#!/bin/bash
NVM_VERSION="0.39.3"
NVM_URL="https://cdn.pisugar.com/PiSugar-wificonfig/script/nvm/v$NVM_VERSION.tar.gz"
NPM_REGISTRY="https://registry.npmmirror.com"
NODE_BINARY_INSTALL_URL="https://cdn.pisugar.com/PiSugar-wificonfig/script/node-binary/install-node-v18.19.1.sh"

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

yarn --registry=$NPM_REGISTRY
yarn build