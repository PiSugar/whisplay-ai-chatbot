#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export APT_LISTCHANGES_FRONTEND=none
export UCF_FORCE_CONFOLD=1

repo_proxy="https://repo.pisugar.uk"
github_base="https://github.com"
repo_path="PiSugar/sugar-wifi-conf"
install_dir="/opt/sugar-wifi-config"
service_name="sugar-wifi-config.service"
service_file="/etc/systemd/system/${service_name}"
suffix="aarch64"

case "$(uname -m)" in
  aarch64|arm64)
    suffix="aarch64"
    ;;
  armv7*)
    suffix="armv7"
    ;;
  armv6*)
    suffix="armv6"
    ;;
  *)
    echo "Unsupported architecture for sugar-wifi-conf: $(uname -m)" >&2
    exit 1
    ;;
esac

mkdir -p "$install_dir"

download_with_fallback() {
  local output="$1"
  shift
  local url
  for url in "$@"; do
    if curl -fSL --retry 3 --retry-all-errors --connect-timeout 20 "$url" -o "$output"; then
      return 0
    fi
  done
  echo "Failed to download $output from all mirrors" >&2
  return 1
}

download_with_fallback \
  "${install_dir}/sugar-wifi-conf" \
  "${repo_proxy}/${repo_path}/releases/latest/download/sugar-wifi-conf-${suffix}" \
  "${github_base}/${repo_path}/releases/latest/download/sugar-wifi-conf-${suffix}"
chmod +x "${install_dir}/sugar-wifi-conf"

if [ ! -f "${install_dir}/custom_config.json" ]; then
  download_with_fallback \
    "${install_dir}/custom_config.json" \
    "${repo_proxy}/${repo_path}/releases/latest/download/custom_config.json" \
    "${github_base}/${repo_path}/releases/latest/download/custom_config.json"
fi

ln -sf "${install_dir}/sugar-wifi-conf" /usr/local/bin/sugar-wifi-conf

cat > "$service_file" <<EOF
[Unit]
Description=Sugar WiFi Configuration Service
After=network.target bluetooth.target
Wants=bluetooth.target

[Service]
ExecStartPre=/usr/sbin/rfkill unblock bluetooth
ExecStart=${install_dir}/sugar-wifi-conf --name raspberrypi --key pisugar --config ${install_dir}/custom_config.json
WorkingDirectory=${install_dir}
Restart=always
RestartSec=5
User=root
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
EOF

mkdir -p /etc/systemd/system/multi-user.target.wants
ln -sf "$service_file" "/etc/systemd/system/multi-user.target.wants/${service_name}"
