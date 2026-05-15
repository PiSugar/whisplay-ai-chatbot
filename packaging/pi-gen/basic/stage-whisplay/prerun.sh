#!/bin/bash -e

if [ -z "${PREV_ROOTFS_DIR:-}" ] || [ ! -d "${PREV_ROOTFS_DIR}" ]; then
  echo "Previous stage rootfs not found: ${PREV_ROOTFS_DIR:-unset}" >&2
  exit 1
fi

mkdir -p "${STAGE_WORK_DIR}"
rm -rf "${ROOTFS_DIR}"
cp -a "${PREV_ROOTFS_DIR}" "${ROOTFS_DIR}"
