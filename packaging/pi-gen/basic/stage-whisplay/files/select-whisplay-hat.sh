#!/bin/bash
set -euo pipefail

select_hat() {
  case "$1" in
    'Raspberry Pi 3 Model B'*|'Raspberry Pi 4 Model B'*|'Raspberry Pi 5 Model B'*)
      modprobe i2c-dev || return 1
      udevadm wait --timeout=10 /dev/i2c-1 || return 1
      # Read the board sensors on I2C1 before relying on any display or audio
      # driver. The IMU also identifies HAT+ revisions with an older compass.
      if [ "$(i2cget -y 1 0x6b 0x00 2>/dev/null)" = 0x05 ] ||
         [ "$(i2cget -y 1 0x2c 0x00 2>/dev/null)" = 0x80 ]; then
        printf '%s\n' hat-plus
        return
      fi
      ;;
  esac
  printf '%s\n' hat
}

configure_hat() (
  local model="$1" profile_dir="$2" boot_profile="$3" runtime_dir="$4"
  local source_profile="$profile_dir/$model.txt"
  local candidate
  test -s "$source_profile"

  if cmp -s "$source_profile" "$boot_profile"; then
    install -d -m 0755 "$runtime_dir"
    touch "$runtime_dir/$model"
    echo "Using Whisplay driver profile: $model"
    return
  fi

  # The firmware applies this include before Linux starts. Restart once
  # after a change, keeping the SPI daemon stopped on this boot.
  candidate="$(mktemp "${boot_profile}.XXXXXX")"
  trap 'rm -f "$candidate"' EXIT
  cat "$source_profile" > "$candidate"
  mv -f "$candidate" "$boot_profile"
  trap - EXIT
  sync -f "$boot_profile"
  echo "Selected Whisplay driver profile: $model; restarting to apply it"
  systemctl --no-block reboot
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  pi_model="$(tr -d '\0' </proc/device-tree/model)"
  hat_model="$(select_hat "$pi_model")"
  configure_hat "$hat_model" /usr/local/lib/whisplay-image/boot-profiles \
    /boot/firmware/whisplay-hat.txt /run/whisplay-image
fi
