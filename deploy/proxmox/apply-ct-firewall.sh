#!/usr/bin/env bash
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || { echo 'run as root on the Proxmox host' >&2; exit 1; }
source_dir="${1:-/root/galactic-sovereign-proxmox}"
ct_id="${GS_PVE_CT_ID:?set GS_PVE_CT_ID to the target Proxmox container ID}"
state=/var/lib/galactic-sovereign-proxmox-firewall
install -d -m 0700 "$state"

if [[ -f /etc/pve/firewall/cluster.fw ]]; then
  install -m 0600 /etc/pve/firewall/cluster.fw "$state/cluster.fw.before"
  rm -f "$state/cluster.absent"
else
  : > "$state/cluster.absent"
fi
if [[ -f "/etc/pve/firewall/${ct_id}.fw" ]]; then
  install -m 0600 "/etc/pve/firewall/${ct_id}.fw" "$state/ct.fw.before"
  rm -f "$state/ct.absent"
else
  : > "$state/ct.absent"
fi

# Compile the guest rules while the cluster firewall remains disabled.
cp "$source_dir/ct.fw" "/etc/pve/firewall/${ct_id}.fw"
if [[ -f /etc/pve/firewall/cluster.fw ]]; then
  install -m 0640 /etc/pve/firewall/cluster.fw "$state/cluster.current"
fi
sed 's/^enable: 1$/enable: 0/' "$source_dir/cluster.fw" > "$state/cluster.staged-disabled"
cp "$state/cluster.staged-disabled" /etc/pve/firewall/cluster.fw
pve-firewall compile >/dev/null

systemctl stop gs-proxmox-firewall-rollback.timer gs-proxmox-firewall-rollback.service 2>/dev/null || true
systemd-run --unit=gs-proxmox-firewall-rollback --on-active=3m "$source_dir/rollback-ct-firewall.sh" >/dev/null
cp "$source_dir/cluster.fw" /etc/pve/firewall/cluster.fw
pve-firewall restart
: > "$state/pending"
echo 'Proxmox CT firewall staged; verify within three minutes, then run confirm-ct-firewall.sh'
