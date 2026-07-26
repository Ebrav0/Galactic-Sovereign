#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_id="${1:-site-$(git -C "$root" rev-parse --short=12 HEAD)-$(date -u +%Y%m%dT%H%M%SZ)}"
[[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{5,79}$ ]] || { echo 'invalid site release id' >&2; exit 2; }
out="${GS_RELEASE_OUTPUT_DIR:-$root/release}"
archive="$out/galactic-sovereign-site-$release_id.tar.gz"
mkdir -p "$out"
(cd "$root/website" && npm ci && npm run build && npm test >&2)
COPYFILE_DISABLE=1 tar --no-xattrs -C "$root/website" -czf "$archive" \
  --exclude=node_modules --exclude=qa --exclude='*.log' \
  package.json package-lock.json server.mjs dist
(cd "$out" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
echo "$archive"
