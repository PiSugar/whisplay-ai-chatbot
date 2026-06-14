#!/bin/bash -e

install -d "${ROOTFS_DIR}/usr/local/lib/whisplay-image"
install -m 0755 ../files/install-whisplay-driver.sh "${ROOTFS_DIR}/usr/local/lib/whisplay-image/install-whisplay-driver.sh"
install -m 0755 ../files/install-sugar-wifi-conf.sh "${ROOTFS_DIR}/usr/local/lib/whisplay-image/install-sugar-wifi-conf.sh"
install -m 0755 ../files/install-whisplay-u-boot.sh "${ROOTFS_DIR}/usr/local/lib/whisplay-image/install-whisplay-u-boot.sh"
install -D -m 0755 ../files/expand-rootfs-firstboot.sh "${ROOTFS_DIR}/usr/local/sbin/whisplay-expand-rootfs"
install -D -m 0644 ../files/whisplay-expand-rootfs.service "${ROOTFS_DIR}/etc/systemd/system/whisplay-expand-rootfs.service"
install -m 0755 ../files/provision-basic.sh "${ROOTFS_DIR}/usr/local/lib/whisplay-image/provision-basic.sh"
