#!/usr/bin/env bash
set -euo pipefail

echo 'deploy-home-ct.sh is retained as a compatibility entrypoint; using the hardened deployer.' >&2
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-secure-home.sh" "$@"
