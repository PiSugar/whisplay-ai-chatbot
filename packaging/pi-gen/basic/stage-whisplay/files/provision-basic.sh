#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export APT_LISTCHANGES_FRONTEND=none
export UCF_FORCE_CONFOLD=1
export NVM_DIR="/home/pi/.nvm"

repo_dir="/home/pi/whisplay-ai-chatbot"
repo_url="${WHISPLAY_CHATBOT_REPO:-https://github.com/PiSugar/whisplay-ai-chatbot.git}"
repo_ref="${WHISPLAY_CHATBOT_REF:-master}"
repo_version="${WHISPLAY_RELEASE_VERSION:-$repo_ref}"
npm_registry="${NPM_REGISTRY:-https://registry.npmjs.org}"
wifi_country="${WIFI_COUNTRY:-GB}"

apt-get update
apt-get install -y \
  alsa-utils \
  bluez \
  curl \
  dkms \
  git \
  i2c-tools \
  jq \
  libasound2-plugins \
  libdbus-1-3 \
  libsox-fmt-mp3 \
  mpg123 \
  python3-dev \
  python3-lgpio \
  python3-libgpiod \
  python3-pip \
  python3-spidev \
  raspi-config \
  rfkill \
  sox \
  sudo \
  unzip \
  xz-utils \
  libcairo2 \
  libcairo2-dev

if command -v raspi-config >/dev/null 2>&1; then
  raspi-config nonint do_spi 0
  raspi-config nonint do_wifi_country "$wifi_country" || true
fi

# Ensure Wi-Fi is enabled at image build time for sugar-wifi-conf BLE provisioning path.
boot_config="/boot/firmware/config.txt"
if [ ! -f "$boot_config" ]; then
  boot_config="/boot/config.txt"
fi
if [ -f "$boot_config" ]; then
  sed -i'' '/^[[:space:]]*dtoverlay=disable-wifi[[:space:]]*$/d' "$boot_config"
fi
rfkill unblock wifi || true

# Keep a baseline wpa_supplicant config present for non-NetworkManager flows.
mkdir -p /etc/wpa_supplicant
if [ ! -f /etc/wpa_supplicant/wpa_supplicant.conf ]; then
  cat > /etc/wpa_supplicant/wpa_supplicant.conf <<EOF
ctrl_interface=DIR=/run/wpa_supplicant GROUP=netdev
update_config=1
country=${wifi_country}
EOF
  chmod 600 /etc/wpa_supplicant/wpa_supplicant.conf
fi
mkdir -p /etc/systemd/system/multi-user.target.wants
if [ -f /usr/lib/systemd/system/wpa_supplicant.service ]; then
  ln -sf /usr/lib/systemd/system/wpa_supplicant.service /etc/systemd/system/multi-user.target.wants/wpa_supplicant.service
fi

if ! command -v node >/dev/null 2>&1 || ! node --version | grep -q '^v20\.'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

/usr/local/lib/whisplay-image/install-whisplay-driver.sh

whisplay_dir="/home/pi/Whisplay"
install_whisplay_daemon() {
  local script
  for script in \
    "$whisplay_dir/daemon/install.sh" \
    "$whisplay_dir/daemon/startup.sh" \
    "$whisplay_dir/Driver/install_whisplay_daemon.sh" \
    "$whisplay_dir/Driver/startup.sh"
  do
    if [ -f "$script" ]; then
      bash "$script" || true
      return 0
    fi
  done
  return 0
}
install_whisplay_daemon

# Ensure daemon service is enabled if unit is present.
if [ -f /etc/systemd/system/whisplay-daemon.service ]; then
  ln -sf /etc/systemd/system/whisplay-daemon.service /etc/systemd/system/multi-user.target.wants/whisplay-daemon.service
elif [ -f /usr/lib/systemd/system/whisplay-daemon.service ]; then
  ln -sf /usr/lib/systemd/system/whisplay-daemon.service /etc/systemd/system/multi-user.target.wants/whisplay-daemon.service
elif [ -f /lib/systemd/system/whisplay-daemon.service ]; then
  ln -sf /lib/systemd/system/whisplay-daemon.service /etc/systemd/system/multi-user.target.wants/whisplay-daemon.service
fi

if [ ! -d "$repo_dir/.git" ]; then
  git clone "$repo_url" "$repo_dir"
fi

cd "$repo_dir"
git fetch --tags --force origin
git checkout --force "$repo_ref"
chown -R pi:pi "$repo_dir"

if [ ! -f .env ]; then
  cp .env.template .env
  chown pi:pi .env
fi

sudo -u pi touch use_npm
sudo -u pi env HOME=/home/pi npm config set registry "$npm_registry"
sudo -u pi env HOME=/home/pi npm install
sudo -u pi env HOME=/home/pi npm run build
chmod +x "$repo_dir/bin/whisplay"
ln -sf "$repo_dir/bin/whisplay" /usr/local/bin/whisplay

cd "$repo_dir/python"
pip3 install -r requirements.txt --break-system-packages

if [ ! -f NotoSansSC-Bold.ttf ]; then
  curl -fL -o NotoSansSC-Bold.ttf https://storage.whisplay.ai/whisplay-ai-chatbot/NotoSansSC-Bold.ttf
fi
if [ ! -f emoji_svg.zip ]; then
  curl -fL -o emoji_svg.zip https://storage.whisplay.ai/whisplay-ai-chatbot/emoji_svg.zip
fi
unzip -o emoji_svg.zip

cd "$repo_dir"

pisugar_installer="$(mktemp)"
curl -fsSL https://cdn.pisugar.com/release/pisugar-power-manager.sh -o "$pisugar_installer"
sed -i'' \
  -e '/^local_host=/d' \
  -e '/^local_ip=/d' \
  -e '/Now navigate to .*8421/d' \
  "$pisugar_installer"
bash "$pisugar_installer" -c release
rm -f "$pisugar_installer"

for service_defaults in /etc/default/pisugar-server /etc/default/pisugar-poweroff; do
  if [ -f "$service_defaults" ]; then
    sed -i'' -E "s/--model '.*'/--model 'PiSugar 3'/g" "$service_defaults"
  fi
done

ensure_pisugar_auth() {
  local config_path="$1"
  local config_dir
  local tmp_json
  config_dir="$(dirname "$config_path")"
  mkdir -p "$config_dir"
  if [ ! -f "$config_path" ]; then
    echo '{}' > "$config_path"
  fi

  tmp_json="$(mktemp)"
  if jq '. + {digest_auth: ["admin","admin"]}' "$config_path" > "$tmp_json"; then
    mv "$tmp_json" "$config_path"
  else
    rm -f "$tmp_json"
    cat > "$config_path" <<'EOF'
{"digest_auth":["admin","admin"]}
EOF
  fi
  chmod 600 "$config_path"
}

ensure_pisugar_auth /etc/pisugar-server/config.json
if [ -f /etc/pisugar/config.json ]; then
  ensure_pisugar_auth /etc/pisugar/config.json
fi

/usr/local/lib/whisplay-image/install-sugar-wifi-conf.sh

cat > /etc/systemd/system/chatbot.service <<'EOF'
[Unit]
Description=Chatbot Service
After=network.target sound.target
Wants=sound.target

[Service]
Type=simple
User=pi
Group=audio
SupplementaryGroups=audio video gpio
WorkingDirectory=/home/pi/whisplay-ai-chatbot
ExecStart=/bin/bash /home/pi/whisplay-ai-chatbot/run_chatbot.sh
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin
Environment=HOME=/home/pi
Environment=XDG_RUNTIME_DIR=/run/user/1000
Environment=NODE_ENV=production
PrivateDevices=no
StandardOutput=append:/home/pi/whisplay-ai-chatbot/chatbot.log
StandardError=append:/home/pi/whisplay-ai-chatbot/chatbot.log
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

touch /home/pi/whisplay-ai-chatbot/chatbot.log
chown pi:pi /home/pi/whisplay-ai-chatbot/chatbot.log
mkdir -p /etc/systemd/system/multi-user.target.wants
# Do not auto-start chatbot.service. It is launched via whisplay-daemon app registry.
rm -f /etc/systemd/system/multi-user.target.wants/chatbot.service

cat > /etc/systemd/system/whisplay-chatbot-register.service <<'EOF'
[Unit]
Description=Register whisplay-ai-chatbot app to whisplay-daemon
After=whisplay-daemon.service network.target
Wants=whisplay-daemon.service

[Service]
Type=oneshot
User=pi
WorkingDirectory=/home/pi/whisplay-ai-chatbot
ExecStart=/usr/bin/node /home/pi/whisplay-ai-chatbot/scripts/register-whisplay-daemon-app.js
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
ln -sf /etc/systemd/system/whisplay-chatbot-register.service /etc/systemd/system/multi-user.target.wants/whisplay-chatbot-register.service

mkdir -p /etc/whisplay-image
cat > /etc/whisplay-image/basic-release <<EOF
WHISPLAY_RELEASE_VERSION=$repo_version
WHISPLAY_CHATBOT_REF=$repo_ref
WHISPLAY_CHATBOT_REPO=$repo_url
EOF
