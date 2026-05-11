#!/bin/bash -e

install -d "${ROOTFS_DIR}/usr/local/lib/whisplay-image"
install -m 0755 ../files/install-whisplay-driver.sh "${ROOTFS_DIR}/usr/local/lib/whisplay-image/install-whisplay-driver.sh"
install -m 0755 ../files/install-sugar-wifi-conf.sh "${ROOTFS_DIR}/usr/local/lib/whisplay-image/install-sugar-wifi-conf.sh"
install -m 0755 ../files/provision-basic.sh "${ROOTFS_DIR}/usr/local/lib/whisplay-image/provision-basic.sh"
