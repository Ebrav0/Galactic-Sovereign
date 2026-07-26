#!/usr/bin/env bash
set -euo pipefail
ct_id="${GS_PVE_CT_ID:?set GS_PVE_CT_ID to the target Proxmox container ID}"
logger -t gs-ups 'UPS low battery: exporting recovery data and creating final immutable archive'
/root/galactic-sovereign-proxmox/export-recovery.sh
pct exec "$ct_id" -- systemctl start galactic-sovereign-immutable-archive.service
pct shutdown "$ct_id" --timeout 180 || pct stop "$ct_id"
logger -t gs-ups 'application CT stopped; NUT may now shut down Proxmox'
