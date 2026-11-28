#!/bin/bash
set -euo pipefail

image_model="${1:-hat}"
repo="${WHISPLAY_UBOOT_REPO:-PiSugar/whisplay-u-boot}"
version="${WHISPLAY_UBOOT_VERSION:-v0.6.0}"
asset="${WHISPLAY_UBOOT_ASSET:-u-boot-whisplay-rpi-arm64.bin}"
logo_asset="${WHISPLAY_UBOOT_LOGO_ASSET:-logo_lcd_240_280_rgb565.bmp}"
github_base="https://github.com"
repo_proxy="https://repo.pisugar.uk"
boot_dir="${BOOT_DIR:-}"
meta_dir="${WHISPLAY_IMAGE_META_DIR:-/etc/whisplay-image}"

if [ -z "$boot_dir" ]; then
  if [ -d /boot/firmware ]; then
    boot_dir="/boot/firmware"
  elif [ -d /boot ]; then
    boot_dir="/boot"
  else
    echo "Boot partition directory not found" >&2
    exit 1
  fi
fi

config_txt="${boot_dir}/config.txt"
if [ ! -f "$config_txt" ]; then
  echo "${config_txt} not found" >&2
  exit 1
fi

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

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

if [ "$version" = "latest" ]; then
  release_path="${repo}/releases/latest/download"
else
  release_path="${repo}/releases/download/${version}"
fi
install_release_asset() {
  local name="$1"
  local local_file="$tmpdir/$name"
  local expected_sha actual_sha

  download_with_fallback "$local_file" \
    "$github_base/$release_path/$name" \
    "$repo_proxy/$release_path/$name"
  download_with_fallback "$local_file.sha256" \
    "$github_base/$release_path/$name.sha256" \
    "$repo_proxy/$release_path/$name.sha256"

  expected_sha="$(awk '{print $1; exit}' "$local_file.sha256")"
  actual_sha="$(sha256sum "$local_file" | awk '{print $1}')"
  if [ "$expected_sha" != "$actual_sha" ]; then
    echo "SHA256 mismatch for $name: expected $expected_sha, got $actual_sha" >&2
    return 1
  fi
  install -m 0644 "$local_file" "$boot_dir/$name"
}

install_plus_splash() {
  local source_dir="$tmpdir/source"
  local splash_dir="$source_dir/plus-splash"
  local theme_dir=/usr/share/plymouth/themes/whisplay-plus
  local cmdline="$boot_dir/cmdline.txt"
  local boot_args option kernel_dir kernel_release initramfs initrd

  boot_args="$(cat "$cmdline")"
  if [[ -z "$boot_args" || "$boot_args" == *$'\n'* ]]; then
    echo "$cmdline must contain a single nonempty line" >&2
    return 1
  fi

  # The theme and hook are shipped in the U-Boot source tag.
  git init -q "$source_dir"
  git -C "$source_dir" fetch --depth 1 "$github_base/$repo.git" "refs/tags/$version"
  git -C "$source_dir" checkout --detach FETCH_HEAD
  apt-get install -y plymouth plymouth-themes initramfs-tools

  install -d -m 0755 "$theme_dir"
  install -m 0644 "$splash_dir"/{whisplay-plus.plymouth,whisplay-plus.script,logo.png} "$theme_dir/"
  install -m 0755 "$splash_dir/initramfs-hook" /etc/initramfs-tools/hooks/whisplay-plus
  plymouth-set-default-theme whisplay-plus

  # pi-gen runs in a chroot. U-Boot expects boot filenames for both image
  # kernels, so build explicitly for their ABIs instead of using uname -r.
  for kernel_dir in /lib/modules/*; do
    kernel_release="${kernel_dir##*/}"
    case "$kernel_release" in
      *-rpi-v8) initramfs=initramfs8 ;;
      *-rpi-2712) initramfs=initramfs_2712 ;;
      *) continue ;;
    esac
    modinfo -k "$kernel_release" st7701p_pisugar >/dev/null
    initrd="/boot/initrd.img-$kernel_release"
    if [ -s "$initrd" ]; then
      update-initramfs -u -k "$kernel_release"
    else
      update-initramfs -c -k "$kernel_release"
    fi
    if ! cmp -s "$initrd" "$boot_dir/$initramfs"; then
      install -m 0644 "$initrd" "$boot_dir/$initramfs"
    fi
  done
  test -s "$boot_dir/initramfs8"
  test -s "$boot_dir/initramfs_2712"

  for option in quiet splash plymouth.ignore-serial-consoles; do
    if [[ " ${boot_args//$'\t'/ } " != *" $option "* ]]; then
      boot_args+=" $option"
    fi
  done
  printf '%s\n' "$boot_args" > "$cmdline"
}

case "$image_model" in
  hat)
    install_release_asset "$asset"
    install_release_asset "$logo_asset"
    ;;
  hat-plus)
    install_release_asset "$asset"
    install_plus_splash
    ;;
  *)
    echo "Unsupported Whisplay image model: $image_model" >&2
    exit 1
    ;;
esac

set_config() {
  local key="$1"
  local value="$2"
  local escaped

  escaped="$(printf '%s' "$value" | sed 's/[\/&]/\\&/g')"
  if grep -qE "^[[:space:]]*#?[[:space:]]*${key}=" "$config_txt"; then
    sed -i "s/^[[:space:]]*#\\?[[:space:]]*${key}=.*/${key}=${escaped}/" "$config_txt"
  else
    printf '%s=%s\n' "$key" "$value" >> "$config_txt"
  fi
}

set_config "enable_uart" "1"
set_config "uart_2ndstage" "1"
set_config "kernel" "$asset"

mkdir -p "$meta_dir"
cat > "${meta_dir}/u-boot-release" <<EOF
WHISPLAY_UBOOT_REPO=$repo
WHISPLAY_UBOOT_VERSION=$version
WHISPLAY_UBOOT_ASSET=$asset
EOF
if [ "$image_model" = hat ]; then
  printf 'WHISPLAY_UBOOT_LOGO_ASSET=%s\n' "$logo_asset" >> "$meta_dir/u-boot-release"
fi
