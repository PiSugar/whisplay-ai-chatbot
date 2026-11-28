#!/bin/bash
set -euo pipefail

repo="${WHISPLAY_UBOOT_REPO:-PiSugar/whisplay-u-boot}"
version="${WHISPLAY_UBOOT_VERSION:-latest}"
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
bin_tmp="${tmpdir}/${asset}"
sha_tmp="${tmpdir}/${asset}.sha256"
logo_tmp="${tmpdir}/${logo_asset}"
logo_sha_tmp="${tmpdir}/${logo_asset}.sha256"

download_with_fallback \
  "$bin_tmp" \
  "${repo_proxy}/${release_path}/${asset}" \
  "${github_base}/${release_path}/${asset}"

if download_with_fallback \
  "$sha_tmp" \
  "${repo_proxy}/${release_path}/${asset}.sha256" \
  "${github_base}/${release_path}/${asset}.sha256"; then
  expected_sha="$(awk '{print $1; exit}' "$sha_tmp")"
  actual_sha="$(sha256sum "$bin_tmp" | awk '{print $1}')"
  if [ "$expected_sha" != "$actual_sha" ]; then
    echo "SHA256 mismatch for ${asset}: expected ${expected_sha}, got ${actual_sha}" >&2
    exit 1
  fi
fi

download_with_fallback \
  "$logo_tmp" \
  "${repo_proxy}/${release_path}/${logo_asset}" \
  "${github_base}/${release_path}/${logo_asset}"

if download_with_fallback \
  "$logo_sha_tmp" \
  "${repo_proxy}/${release_path}/${logo_asset}.sha256" \
  "${github_base}/${release_path}/${logo_asset}.sha256"; then
  expected_logo_sha="$(awk '{print $1; exit}' "$logo_sha_tmp")"
  actual_logo_sha="$(sha256sum "$logo_tmp" | awk '{print $1}')"
  if [ "$expected_logo_sha" != "$actual_logo_sha" ]; then
    echo "SHA256 mismatch for ${logo_asset}: expected ${expected_logo_sha}, got ${actual_logo_sha}" >&2
    exit 1
  fi
fi

install -m 0644 "$bin_tmp" "${boot_dir}/${asset}"
install -m 0644 "$logo_tmp" "${boot_dir}/${logo_asset}"

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
WHISPLAY_UBOOT_LOGO_ASSET=$logo_asset
EOF
