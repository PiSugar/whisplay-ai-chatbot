#!/bin/bash
set -euo pipefail

files="$(dirname "$0")/stage-whisplay/files"
source "$files/select-whisplay-hat.sh"

workspace="$(mktemp -d)"
trap 'rm -rf "$workspace"' EXIT
boot_profile="$workspace/whisplay-hat.txt"
runtime_dir="$workspace/run"
profile_dir="$workspace/profiles"
reboot_log="$workspace/reboot"
pi5='Raspberry Pi 5 Model B Rev 1.0'
pi_zero='Raspberry Pi Zero 2 W Rev 1.0'

modprobe() { [ "$*" = i2c-dev ]; }
udevadm() { [ "$*" = 'wait --timeout=10 /dev/i2c-1' ] && [ "${bus_missing:-0}" = 0 ]; }
i2cget() {
  case "$*" in
    '-y 1 0x6b 0x00') printf '%s\n' "${imu_id:-}" ;;
    '-y 1 0x2c 0x00') printf '%s\n' "${compass_id:-}" ;;
    *) return 1 ;;
  esac
}
sync() { [ "$*" = "-f $boot_profile" ]; }
systemctl() {
  [ "$*" = '--no-block reboot' ] || return 1
  printf '%s\n' reboot >> "$reboot_log"
}

[ "$(select_hat "$pi5")" = hat ]
[ "$(imu_id=0x05 select_hat "$pi5")" = hat-plus ]
[ "$(compass_id=0x80 select_hat "$pi5")" = hat-plus ]
[ "$(imu_id=0x09 compass_id=0xff select_hat "$pi5")" = hat ]
[ "$(imu_id=0x05 select_hat "$pi_zero")" = hat ]
if bus_missing=1 select_hat "$pi5"; then
  echo 'Detection must fail if the I2C adapter is absent' >&2
  exit 1
fi

mkdir "$profile_dir"
cp "$files/hat-plus.txt" "$profile_dir/"
printf '%s\n' 'dtoverlay=whisplay-soundcard' 'kernel=u-boot-whisplay-rpi-arm64.bin' > "$profile_dir/hat.txt"
printf '%s\n' '# Selected on first boot.' > "$boot_profile"
configure_hat hat "$profile_dir" "$boot_profile" "$runtime_dir"
test ! -e "$runtime_dir/hat"
cmp "$profile_dir/hat.txt" "$boot_profile"
configure_hat hat "$profile_dir" "$boot_profile" "$runtime_dir"
test -e "$runtime_dir/hat"
[ "$(wc -l < "$reboot_log")" -eq 1 ]

# Simulate moving the image to HAT+ hardware and the subsequent automatic boot.
rm -r "$runtime_dir"
configure_hat hat-plus "$profile_dir" "$boot_profile" "$runtime_dir"
test ! -e "$runtime_dir/hat"
cmp "$profile_dir/hat-plus.txt" "$boot_profile"
grep -qxF 'dtoverlay=whisplay-plus' "$boot_profile"
[ "$(grep -xcF 'dtoverlay=whisplay-plus,display_dsi=1' "$boot_profile")" -eq 2 ]
[ "$(grep -c '^dtoverlay=' "$boot_profile")" -eq 3 ]
configure_hat hat-plus "$profile_dir" "$boot_profile" "$runtime_dir"
test -e "$runtime_dir/hat-plus"
[ "$(wc -l < "$reboot_log")" -eq 2 ]

# Switching back removes the HAT+ overlay and allows the SPI daemon on reboot.
rm -r "$runtime_dir"
configure_hat hat "$profile_dir" "$boot_profile" "$runtime_dir"
test ! -e "$runtime_dir/hat"
cmp "$profile_dir/hat.txt" "$boot_profile"
configure_hat hat "$profile_dir" "$boot_profile" "$runtime_dir"
test -e "$runtime_dir/hat"
[ "$(wc -l < "$reboot_log")" -eq 3 ]
