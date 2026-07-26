#!/usr/bin/env bash
set -euo pipefail
state=/var/lib/galactic-sovereign-proxmox-firewall
[[ -f "$state/pending" ]] || { echo 'no pending Proxmox firewall change' >&2; exit 1; }
systemctl stop gs-proxmox-firewall-rollback.timer gs-proxmox-firewall-rollback.service 2>/dev/null || true
systemctl reset-failed gs-proxmox-firewall-rollback.service 2>/dev/null || true
rm -f "$state/pending"
pve-firewall status
echo 'Proxmox CT firewall confirmed'
