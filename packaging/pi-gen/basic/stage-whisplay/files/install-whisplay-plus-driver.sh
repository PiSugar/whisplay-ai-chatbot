#!/bin/bash
set -euo pipefail

boot_dir="$1"
source_dir="$(mktemp -d)"
trap 'rm -rf "$source_dir"' EXIT

# Match the upstream HAT+ release image's panel driver and aggregate overlay.
revision=b29d38cd7538d33a783c9b33618010c57a53a407
git -C "$source_dir" init -q
git -C "$source_dir" fetch --depth 1 https://github.com/PiSugar/whisplay-plus.git "$revision"
git -C "$source_dir" checkout --detach FETCH_HEAD

# The unified sound-card module already supports the HAT+ audio nodes. Build
# only the panel module here, so both overlays use the same ALSA driver.
panel_dir="$source_dir/display/driver"
for kernel_dir in /lib/modules/*; do
  [ -d "$kernel_dir/build" ] || {
    echo "Missing kernel headers: $kernel_dir/build" >&2
    exit 1
  }
  make -C "$panel_dir" KDIR="$kernel_dir/build" clean
  make -C "$panel_dir" KDIR="$kernel_dir/build"
  install -D -m 0644 "$panel_dir/st7701p_pisugar.ko" "$kernel_dir/extra/st7701p_pisugar.ko"
  depmod -a "${kernel_dir##*/}"
done

cpp -nostdinc -undef -x assembler-with-cpp "$source_dir/overlay/whisplay-plus.dts" |
  dtc -@ -I dts -O dtb -o "$boot_dir/overlays/whisplay-plus.dtbo" -
