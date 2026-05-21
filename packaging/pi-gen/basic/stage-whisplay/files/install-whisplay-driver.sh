#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export APT_LISTCHANGES_FRONTEND=none
export UCF_FORCE_CONFOLD=1

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

whisplay_dir="/home/pi/Whisplay"
boot_config="/boot/firmware/config.txt"
if [ ! -f "$boot_config" ]; then
  boot_config="/boot/config.txt"
fi

if [ ! -d "$whisplay_dir/.git" ]; then
  mkdir -p /home/pi
  git clone --depth 1 https://github.com/PiSugar/Whisplay.git "$whisplay_dir"
else
  git -C "$whisplay_dir" fetch --depth 1 origin
  git -C "$whisplay_dir" reset --hard origin/HEAD
fi
chown -R pi:pi "$whisplay_dir"

driver_zip="$(find "$whisplay_dir" -type f -name 'WM8960-Audio-HAT.zip' -print -quit || true)"
if [ -z "${driver_zip:-}" ] || [ ! -f "$driver_zip" ]; then
  echo "WM8960-Audio-HAT.zip not found in Whisplay repo: $whisplay_dir" >&2
  exit 1
fi
unzip -o "$driver_zip" -d "$tmpdir"

service_path="$(find "$tmpdir" -maxdepth 3 -type f -name 'wm8960-soundcard.service' -print -quit || true)"
workdir=""
if [ -n "$service_path" ]; then
  workdir="$(dirname "$service_path")"
fi
if [ -z "${workdir:-}" ] || [ ! -d "$workdir" ]; then
  echo "Unable to locate unpacked WM8960 driver files from zip: $driver_zip" >&2
  exit 1
fi

mkdir -p /etc/wm8960-soundcard
cp -f "$workdir"/*.conf /etc/wm8960-soundcard/
cp -f "$workdir"/*.state /etc/wm8960-soundcard/
cp -f "$workdir/wm8960-soundcard" /usr/bin/
chmod 0755 /usr/bin/wm8960-soundcard

unit_file="/lib/systemd/system/wm8960-soundcard.service"
if [ -d /lib/systemd/system ]; then
  cp -f "$workdir/wm8960-soundcard.service" "$unit_file"
else
  unit_file="/usr/lib/systemd/system/wm8960-soundcard.service"
  mkdir -p /usr/lib/systemd/system
  cp -f "$workdir/wm8960-soundcard.service" "$unit_file"
fi

touch /etc/modules
for module in i2c-dev snd-soc-wm8960 snd-soc-wm8960-soundcard; do
  grep -qxF "$module" /etc/modules || echo "$module" >> /etc/modules
done

ensure_config_line() {
  local line="$1"
  if grep -qxF "#$line" "$boot_config"; then
    sed -i "s|^#$line$|$line|" "$boot_config"
  elif ! grep -qxF "$line" "$boot_config"; then
    echo "$line" >> "$boot_config"
  fi
}

ensure_config_line "dtparam=i2c_arm=on"
ensure_config_line "dtparam=i2s=on"
ensure_config_line "dtoverlay=i2s-mmap"
ensure_config_line "dtoverlay=wm8960-soundcard"

if grep -qxF "alsactl restore" /usr/bin/wm8960-soundcard; then
  awk '
    $0 == "alsactl restore" {
      print "if ! alsactl restore; then"
      print "    echo \"[WARN] alsactl restore failed - continuing anyway\""
      print "fi"
      next
    }
    { print }
  ' /usr/bin/wm8960-soundcard > /usr/bin/wm8960-soundcard.tmp
  mv /usr/bin/wm8960-soundcard.tmp /usr/bin/wm8960-soundcard
  chmod 0755 /usr/bin/wm8960-soundcard
fi

mkdir -p /etc/systemd/system/multi-user.target.wants
if [ ! -f "$unit_file" ]; then
  echo "wm8960-soundcard.service not found after driver installation" >&2
  exit 1
fi
ln -sf "$unit_file" /etc/systemd/system/multi-user.target.wants/wm8960-soundcard.service
