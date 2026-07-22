#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config="${GS_DEPLOY_CONFIG:-$root/.deploy.local.env}"
[[ -r "$config" ]] || { echo "missing untracked deployment config: $config" >&2; exit 1; }
# shellcheck disable=SC1090
source "$config"
: "${GS_PVE_SSH_HOST:?set GS_PVE_SSH_HOST}"
: "${GS_PVE_CT_ID:?set GS_PVE_CT_ID}"
: "${GS_LEGACY_WORLD_PATH:?set GS_LEGACY_WORLD_PATH}"
: "${GS_LEGACY_RELEASE_PATH:?set GS_LEGACY_RELEASE_PATH}"
[[ "$GS_PVE_CT_ID" =~ ^[0-9]{2,6}$ ]] || { echo 'invalid CT id' >&2; exit 2; }
[[ "$GS_LEGACY_WORLD_PATH" =~ ^/[A-Za-z0-9._/-]+$ && "$GS_LEGACY_WORLD_PATH" != / ]] || { echo 'invalid legacy world path' >&2; exit 2; }
[[ "$GS_LEGACY_RELEASE_PATH" =~ ^/[A-Za-z0-9._/-]+$ && "$GS_LEGACY_RELEASE_PATH" != / ]] || { echo 'invalid legacy release path' >&2; exit 2; }
release_id="${1:-$(git -C "$root" rev-parse --short=12 HEAD)-$(date -u +%Y%m%dT%H%M%SZ)}"
archive="$(GS_RELEASE_OUTPUT_DIR="${GS_RELEASE_OUTPUT_DIR:-$root/release}" "$root/scripts/package-hosted-release.sh" "$release_id")"
sums="$archive.sha256"

echo "Creating Proxmox and file-level backups before mutation"
if [[ -n "${GS_PVE_BACKUP_STORAGE:-}" ]]; then
  [[ "$GS_PVE_BACKUP_STORAGE" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'invalid Proxmox storage name' >&2; exit 2; }
  ssh "root@$GS_PVE_SSH_HOST" "vzdump '$GS_PVE_CT_ID' --mode snapshot --compress zstd --storage '$GS_PVE_BACKUP_STORAGE'"
else
  ssh "root@$GS_PVE_SSH_HOST" "vzdump '$GS_PVE_CT_ID' --mode snapshot --compress zstd"
fi
echo "Bootstrapping bounded administration and hardened service layout"
tar -C "$root" -czf - deploy | ssh "root@$GS_PVE_SSH_HOST" "pct exec '$GS_PVE_CT_ID' -- tar -xzf - -C /var/tmp"
ssh "root@$GS_PVE_SSH_HOST" "pct exec '$GS_PVE_CT_ID' -- bash -lc 'cd /var/tmp && ./deploy/bootstrap-ct.sh'"
printf 'GS_LEGACY_WORLD_PATH=%q\nGS_LEGACY_RELEASE_PATH=%q\n' "$GS_LEGACY_WORLD_PATH" "$GS_LEGACY_RELEASE_PATH" | \
  ssh "root@$GS_PVE_SSH_HOST" "pct exec '$GS_PVE_CT_ID' -- sh -c 'umask 077; cat > /etc/galactic-sovereign/legacy.env'"

echo "Transferring immutable release"
cat "$archive" | ssh "root@$GS_PVE_SSH_HOST" "pct exec '$GS_PVE_CT_ID' -- sh -c 'umask 077; cat > /var/tmp/galactic-sovereign-$release_id.tar.gz'"
cat "$sums" | ssh "root@$GS_PVE_SSH_HOST" "pct exec '$GS_PVE_CT_ID' -- sh -c 'umask 077; cat > /var/tmp/galactic-sovereign-$release_id.tar.gz.sha256'"
echo "Stopping the old writer for the immutable file-level copy and migration"
ssh "root@$GS_PVE_SSH_HOST" "pct exec '$GS_PVE_CT_ID' -- bash -lc 'set -e; systemctl stop galactic-sovereign-coop.service; install -d -m0700 /var/lib/galactic-sovereign/pre-migration; install -m0600 '$GS_LEGACY_WORLD_PATH' /var/lib/galactic-sovereign/pre-migration/original-world.json; tar -C '$GS_LEGACY_RELEASE_PATH' --exclude=.git --exclude=node_modules -czf /var/lib/galactic-sovereign/pre-migration/original-release.tar.gz .; chmod 0600 /var/lib/galactic-sovereign/pre-migration/original-release.tar.gz; sha256sum /var/lib/galactic-sovereign/pre-migration/original-world.json /var/lib/galactic-sovereign/pre-migration/original-release.tar.gz > /var/lib/galactic-sovereign/pre-migration/SHA256SUMS'"
ssh "root@$GS_PVE_SSH_HOST" "pct exec '$GS_PVE_CT_ID' -- /usr/local/sbin/gsctl deploy '$release_id'"

echo "Release deployed on loopback. Public tunnel, Access, and OpenSSH cutover remain separate verified steps."
