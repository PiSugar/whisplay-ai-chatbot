#!/bin/bash
NVM_VERSION="0.39.3"
NVM_URL="https://cdn.pisugar.com/PiSugar-wificonfig/script/nvm/v$NVM_VERSION.tar.gz"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org}"
source "$(dirname "${BASH_SOURCE[0]}")/scripts/with-node.sh"

# read parameters --use-npm
if [ -f "use_npm" ]; then
  use_npm=true
else
  use_npm=false
fi

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# apt install sox libsox-fmt-mp3 mpg123 and other dependencies
sudo apt-get update
sudo apt-get install -y sox mpg123 libsox-fmt-mp3 python3-dev libcairo2 libcairo2-dev unzip python3-lgpio ffmpeg \
    python3-numpy python3-pillow python3-flask python3-opencv python3-spidev python3-rpi.gpio patchelf

# Fix libmad executable stack issue on modern kernels (required for MP3 support)
# Without this fix, sox cannot encode/decode MP3 files on Raspberry Pi OS Bookworm+
if [ -f "/lib/arm-linux-gnueabihf/libmad.so.0" ]; then
    echo "Fixing libmad executable stack flag for MP3 support..."
    sudo patchelf --clear-execstack /lib/arm-linux-gnueabihf/libmad.so.0 2>/dev/null || true
fi

# enable spi
sudo raspi-config nonint do_spi 0

# install python dependencies
echo "Installing Python dependencies..."
cd python
pip install -r requirements.txt --break-system-packages
# download fonts and emojis
if command_exists wget; then
    if [ ! -f "NotoSansSC-Bold.ttf" ]; then
        wget -O NotoSansSC-Bold.ttf https://storage.whisplay.ai/whisplay-ai-chatbot/NotoSansSC-Bold.ttf
    else
        echo "NotoSansSC-Bold.ttf already exists, skip download."
    fi

    if [ ! -f "emoji_svg.zip" ]; then
        wget -O emoji_svg.zip https://storage.whisplay.ai/whisplay-ai-chatbot/emoji_svg.zip
    else
        echo "emoji_svg.zip already exists, skip download."
    fi
elif command_exists curl; then
    if [ ! -f "NotoSansSC-Bold.ttf" ]; then
        curl -fL -o NotoSansSC-Bold.ttf https://storage.whisplay.ai/whisplay-ai-chatbot/NotoSansSC-Bold.ttf
    else
        echo "NotoSansSC-Bold.ttf already exists, skip download."
    fi

    if [ ! -f "emoji_svg.zip" ]; then
        curl -fL -o emoji_svg.zip https://storage.whisplay.ai/whisplay-ai-chatbot/emoji_svg.zip
    else
        echo "emoji_svg.zip already exists, skip download."
    fi
else
    echo "Neither wget nor curl is installed."
    exit 1
fi
# overwrite if exists
unzip -o emoji_svg.zip
cd ..


# Check if git is installed
# if ! command_exists git; then
#     echo "git is not installed. Installing git..."
#     sudo apt-get install -y git

#     # Verify installation
#     if command_exists git; then
#         echo "git installed successfully."
#     else
#         echo "Failed to install git."
#         exit 1
#     fi
# fi

install_node_nvm() {
    local archive_dir mirror
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    echo "Installing Node.js $WHISPLAY_NODE_MAJOR using nvm..."

    if [ ! -s "$NVM_DIR/nvm.sh" ]; then
        echo "Installing nvm..."
        archive_dir=$(mktemp -d) || return 1
        if ! curl -fsSL "$NVM_URL" -o "$archive_dir/nvm.tar.gz" ||
           ! mkdir -p "$NVM_DIR" ||
           ! tar -xzf "$archive_dir/nvm.tar.gz" --strip-components=1 -C "$NVM_DIR"; then
            rm -rf "$archive_dir"
            return 1
        fi
        rm -rf "$archive_dir"

        if ! grep -qs 'NVM_DIR/nvm.sh' "$HOME/.bashrc"; then
            printf '\nexport NVM_DIR=%q\n' "$NVM_DIR" >> "$HOME/.bashrc"
            printf '%s\n' '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"' \
                '[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"' >> "$HOME/.bashrc"
        fi
    fi

    whisplay_load_nvm || return 1
    mirror="${NVM_NODEJS_ORG_MIRROR:-https://nodejs.org/dist}"
    if [[ "$(uname -m)" == "armv6l" ]]; then
        # The original Pi Zero needs the community ARMv6 binary.
        mirror="${NVM_NODEJS_ORG_MIRROR:-https://unofficial-builds.nodejs.org/download/release}"
    fi
    NVM_NODEJS_ORG_MIRROR="$mirror" nvm install -b "$WHISPLAY_NODE_MAJOR" &&
        whisplay_select_node &&
        whisplay_node_is_current &&
        nvm alias default "$WHISPLAY_NODE_MAJOR"
}

if ! whisplay_select_node && ! install_node_nvm; then
    echo "Failed to install Node.js $WHISPLAY_NODE_MAJOR. Update stopped." >&2
    exit 1
fi
echo "Using Node.js $(node --version)."

# Check if npm is installed
if ! command_exists npm; then
    echo "npm is not installed. Installing npm..."
    sudo apt-get install -y npm

    # Verify installation
    if command_exists npm; then
        echo "npm installed successfully."
    else
        echo "Failed to install npm."
        exit 1
    fi
fi

# check if yarn is installed, fallback to npm if installation fails
if [ "$use_npm" = false ] && ! command_exists yarn; then
    echo "yarn is not installed. Installing yarn..."
    npm config set registry $NPM_REGISTRY
    npm install -g yarn
    export PATH="$HOME/.yarn/bin:$HOME/.config/yarn/global/node_modules/.bin:$PATH"

    # Verify installation, fallback to npm if yarn install failed
    if command_exists yarn; then
        echo "yarn installed successfully."
    else
        echo "WARNING: Failed to install yarn. Falling back to npm."
        use_npm=true
    fi
fi

#sudo ln -s "$NVM_DIR/versions/node/$(nvm version)/bin/node" "/usr/local/bin/node"
#sudo ln -s "$NVM_DIR/versions/node/$(nvm version)/bin/npm" "/usr/local/bin/npm"
#sudo ln -s "$NVM_DIR/versions/node/$(nvm version)/bin/npx" "/usr/local/bin/npx"

echo "Installing Node.js dependencies..."
if [ "$use_npm" = false ]; then
    echo "Using yarn to install dependencies."
    if ! yarn --registry="$NPM_REGISTRY"; then
        echo "WARNING: yarn failed. Falling back to npm."
        use_npm=true
    fi
fi
if [ "$use_npm" = true ]; then
    echo "Using npm to install dependencies."
    npm install --registry="$NPM_REGISTRY" || exit 1
fi

if [ "${1:-}" = "--build" ]; then
    echo "Building with Node.js $(node --version)..."
    if [ "$use_npm" = true ]; then
        npm run build || exit 1
    else
        yarn run build || exit 1
    fi
fi

# Install whisplay CLI
echo "Installing whisplay CLI..."
chmod +x "$(pwd)/bin/whisplay"
WHISPLAY_BIN="$(pwd)/bin/whisplay"

# Try symlink to /usr/local/bin (may need sudo on some systems)
if sudo ln -sf "$WHISPLAY_BIN" /usr/local/bin/whisplay 2>/dev/null; then
    echo "whisplay CLI installed to /usr/local/bin/whisplay"
else
    # Fallback: add project bin/ to PATH via .bashrc
    WHISPLAY_BIN_DIR="$(pwd)/bin"
    if ! grep -q "$WHISPLAY_BIN_DIR" "$HOME/.bashrc" 2>/dev/null; then
        echo "export PATH=\"$WHISPLAY_BIN_DIR:\$PATH\"" >> "$HOME/.bashrc"
        echo "whisplay CLI added to PATH via ~/.bashrc (restart shell or run: source ~/.bashrc)"
    fi
    export PATH="$WHISPLAY_BIN_DIR:$PATH"
fi
echo "whisplay CLI installed. Run 'whisplay help' to get started."
echo "If you run into installation issues, ask in our Discord forum: https://discord.gg/NMpCMP8RS8"
