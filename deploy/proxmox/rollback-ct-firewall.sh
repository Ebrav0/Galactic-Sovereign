#!/usr/bin/env bash
set -euo pipefail
state=/var/lib/galactic-sovereign-proxmox-firewall
ct_id="${GS_PVE_CT_ID:?set GS_PVE_CT_ID to the target Proxmox container ID}"
if [[ -f "$state/cluster.absent" ]]; then rm -f /etc/pve/firewall/cluster.fw; else cp "$state/cluster.fw.before" /etc/pve/firewall/cluster.fw; fi
if [[ -f "$state/ct.absent" ]]; then rm -f "/etc/pve/firewall/${ct_id}.fw"; else cp "$state/ct.fw.before" "/etc/pve/firewall/${ct_id}.fw"; fi
pve-firewall restart
rm -f "$state/pending"
echo 'Proxmox CT firewall automatically rolled back' >&2
