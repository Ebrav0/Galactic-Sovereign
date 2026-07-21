#!/usr/bin/env bash
# Deploy Galactic Sovereign to home Proxmox CT 909 (galactic-sovereign).
# Requires Tailscale SSH access to the Proxmox host (halcyon).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PVE_HOST="${GS_PVE_HOST:-100.65.176.48}"
CT_ID="${GS_CT_ID:-909}"
CT_DIR="${GS_CT_DIR:-/root/Galactic-Sovereign}"
RESET_WORLD="${GS_COOP_RESET_REMOTE:-0}"

echo "[deploy] packing $ROOT → CT $CT_ID on $PVE_HOST"
cd "$ROOT"
tar czf - \
  --exclude node_modules \
  --exclude .git \
  --exclude server/data \
  --exclude .playwright-mcp \
  --exclude dist \
  --exclude 'Galactic%20Soverign' \
  . | ssh -o ConnectTimeout=30 "root@${PVE_HOST}" \
  "pct exec ${CT_ID} -- bash -lc 'mkdir -p ${CT_DIR} && tar xzf - -C ${CT_DIR}'"

echo "[deploy] install + build + restart services"
ssh -o ConnectTimeout=30 "root@${PVE_HOST}" "pct exec ${CT_ID} -- bash -s" <<REMOTE
set -e
cd ${CT_DIR}
npm install --silent
npm run build
mkdir -p server/data
if [ "${RESET_WORLD}" = "1" ]; then
  systemctl stop galactic-sovereign-coop || true
  rm -f server/data/world.json server/data/world.json.tmp
  echo "[deploy] wiped world.json"
fi
systemctl restart galactic-sovereign-web galactic-sovereign-coop
sleep 2
systemctl is-active galactic-sovereign-web galactic-sovereign-coop
curl -sf http://127.0.0.1:9090/health >/dev/null && echo "[deploy] coop health OK"
# serve can take a beat after restart
for i in 1 2 3 4 5; do
  if curl -sf -o /dev/null http://127.0.0.1:8080/; then
    echo "[deploy] web OK"
    break
  fi
  sleep 1
done
REMOTE

echo "[deploy] done"
echo "  game:  http://100.67.50.44:8080/?coop=ws://100.67.50.44:9090&coopName=alpha"
echo "  peer:  http://100.67.50.44:8080/?coop=ws://100.67.50.44:9090&coopName=beta"
