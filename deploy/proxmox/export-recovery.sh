#!/usr/bin/env bash
set -euo pipefail
[[ "$(id -u)" -eq 0 ]] || exit 1
ct_id="${GS_PVE_CT_ID:?set GS_PVE_CT_ID to the target Proxmox container ID}"
work="$(mktemp -d /run/gs-recovery-export.XXXXXX)"
trap 'rm -rf -- "$work"' EXIT
pct exec "$ct_id" -- install -d -o root -g root -m 0700 /var/lib/galactic-sovereign/recovery
pct config "$ct_id" | sed -E 's/(password|token|secret|key):.*/\1: REDACTED/I' > "$work/proxmox-ct.conf"
cp "/etc/pve/firewall/${ct_id}.fw" "$work/proxmox-ct.fw"
cp /etc/pve/firewall/cluster.fw "$work/proxmox-cluster.fw"
for file in "$work"/*; do
  pct push "$ct_id" "$file" "/var/lib/galactic-sovereign/recovery/$(basename "$file")" -perms 0600
done
