#!/bin/bash
set -euo pipefail

marker="/var/lib/whisplay-image/rootfs-expanded"
service_name="whisplay-expand-rootfs.service"

log() {
  echo "[whisplay-expand-rootfs] $*"
}

if [ -f "$marker" ]; then
  log "rootfs expansion already completed"
  systemctl disable "$service_name" >/dev/null 2>&1 || true
  exit 0
fi

root_majmin="$(findmnt -n -o MAJ:MIN /)"
root_device="$(lsblk -pn -o NAME,MAJ:MIN | awk -v majmin="$root_majmin" '$2 == majmin { print $1; exit }')"
root_fstype="$(findmnt -n -o FSTYPE /)"

if [ -z "$root_device" ]; then
  root_source="$(findmnt -n -o SOURCE /)"
  root_device="$(readlink -f "$root_source")"
fi

if [ "$root_fstype" != "ext4" ]; then
  log "unsupported root filesystem type: $root_fstype"
  exit 0
fi

parent_name="$(lsblk -no PKNAME "$root_device" | head -n1)"
part_num="$(lsblk -no PARTN "$root_device" | head -n1)"

if [ -z "$parent_name" ] || [ -z "$part_num" ]; then
  log "could not resolve parent disk or partition number for $root_device"
  exit 1
fi

parent_disk="/dev/$parent_name"
install -d -m 0755 /var/lib/whisplay-image

log "expanding partition $root_device on $parent_disk"
if command -v growpart >/dev/null 2>&1; then
  growpart "$parent_disk" "$part_num" || true
else
  sfdisk -d "$parent_disk" > "/var/lib/whisplay-image/${parent_name}.sfdisk.before"
  echo ", +" | sfdisk --no-reread -N "$part_num" "$parent_disk" || true
fi

partprobe "$parent_disk" >/dev/null 2>&1 || true
partx -u "$parent_disk" >/dev/null 2>&1 || true
udevadm settle || true

log "resizing ext4 filesystem on $root_device"
resize2fs "$root_device"

date -Is > "$marker"
systemctl disable "$service_name" >/dev/null 2>&1 || true
log "rootfs expansion completed"
