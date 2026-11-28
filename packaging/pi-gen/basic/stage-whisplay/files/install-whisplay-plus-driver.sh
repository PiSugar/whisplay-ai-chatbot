#!/bin/bash
set -euo pipefail

boot_dir="$1"
source_dir="$(mktemp -d)"
trap 'rm -rf "$source_dir"' EXIT

if ! apt-get install -y raspberrypi-kernel-headers; then
  apt-get install -y linux-headers-rpi-2712 linux-headers-rpi-v8
fi

# Match the upstream HAT+ release image's panel driver and aggregate overlay.
revision=b29d38cd7538d33a783c9b33618010c57a53a407
git -C "$source_dir" init -q
git -C "$source_dir" fetch --depth 1 https://github.com/PiSugar/whisplay-plus.git "$revision"
git -C "$source_dir" checkout --detach FETCH_HEAD

panel_dir="$source_dir/display/driver"
sound_dir="$source_dir/sound"
for kernel_dir in /lib/modules/*; do
  [ -d "$kernel_dir/build" ] || {
    echo "Missing kernel headers: $kernel_dir/build" >&2
    exit 1
  }
  make -C "$panel_dir" KDIR="$kernel_dir/build" clean
  make -C "$panel_dir" KDIR="$kernel_dir/build"
  make -C "$sound_dir" KDIR="$kernel_dir/build" clean
  make -C "$sound_dir" KDIR="$kernel_dir/build"
  install -D -m 0644 "$panel_dir/st7701p_pisugar.ko" "$kernel_dir/extra/st7701p_pisugar.ko"
  install -m 0644 "$sound_dir/snd-soc-whisplay-soundcard.ko" "$kernel_dir/extra/snd-soc-whisplay-soundcard.ko"
  depmod -a "${kernel_dir##*/}"
done

cpp -nostdinc -undef -x assembler-with-cpp "$source_dir/overlay/whisplay-plus.dts" |
  dtc -@ -I dts -O dtb -o "$boot_dir/overlays/whisplay-plus.dtbo" -

cat >> "$boot_dir/config.txt" <<'EOF'

[all]
# Whisplay HAT+ display, touch, and audio
dtparam=i2c_arm=on
dtparam=i2s=on
[pi3]
dtparam=i2c_csi_dsi=on
camera_auto_detect=0
dtoverlay=whisplay-plus,display_dsi=1
[pi4]
dtparam=i2c_csi_dsi=on
camera_auto_detect=0
dtoverlay=whisplay-plus,display_dsi=1
[pi5]
dtoverlay=whisplay-plus
[all]
EOF

cat > /etc/modules-load.d/whisplay-hat-plus.conf <<'EOF'
st7701p_pisugar
snd-soc-whisplay-soundcard
EOF

if [ -f /etc/xdg/labwc/rc.xml ]; then
  sed -i '/Goodix Capacitive TouchScreen/ s/mouseEmulation="yes"/mouseEmulation="no"/g' /etc/xdg/labwc/rc.xml
fi

cat > /etc/asound.conf <<'EOF'
pcm.!default {
    type plug
    slave.pcm "whisplaysound"
}

ctl.!default {
    type hw
    card whisplaysound
}
EOF
