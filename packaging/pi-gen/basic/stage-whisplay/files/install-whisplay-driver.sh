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

driver_dir="$whisplay_dir/Driver"
workdir="$tmpdir/WM8960-Audio-HAT"
unzip -o "$driver_dir/WM8960-Audio-HAT.zip" -d "$tmpdir"

mkdir -p /etc/wm8960-soundcard
cp -f "$workdir"/*.conf /etc/wm8960-soundcard/
cp -f "$workdir"/*.state /etc/wm8960-soundcard/
cp -f "$workdir/wm8960-soundcard" /usr/bin/

unit_file="/lib/systemd/system/wm8960-soundcard.service"
if [ -d /lib/systemd/system ]; then
  cp -f "$workdir/wm8960-soundcard.service" "$unit_file"
else
  unit_file="/usr/lib/systemd/system/wm8960-soundcard.service"
  mkdir -p /usr/lib/systemd/system
  cp -f "$workdir/wm8960-soundcard.service" "$unit_file"
fi

chmod 0755 /usr/bin/wm8960-soundcard

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
ln -sf "$unit_file" /etc/systemd/system/multi-user.target.wants/wm8960-soundcard.service
