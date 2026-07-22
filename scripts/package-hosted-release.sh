#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_id="${1:-$(git -C "$root" rev-parse --short=12 HEAD)-$(date -u +%Y%m%dT%H%M%SZ)}"
[[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{5,79}$ ]] || { echo 'invalid release id' >&2; exit 2; }
out="${GS_RELEASE_OUTPUT_DIR:-$root/release}"
archive="$out/galactic-sovereign-$release_id.tar.gz"
mkdir -p "$out"

(cd "$root" && npm run build >&2)
COPYFILE_DISABLE=1 tar --no-xattrs -C "$root" -czf "$archive" \
  --exclude=.git --exclude=.github --exclude=.playwright-mcp --exclude=.deploy.local.env \
  --exclude=node_modules --exclude=release --exclude=output --exclude='*.log' \
  --exclude='*.sqlite*' --exclude='world.json*' --exclude='server/data' \
  package.json package-lock.json dist server src/js deploy \
  scripts/migrate-multiplayer-world.mjs scripts/verify-live-world-migration.mjs
(cd "$out" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
echo "$archive"
