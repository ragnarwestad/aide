#!/bin/bash
# Publish out/index.html to the mac mini's serve directory.
# openrsync-compatible flags only — macOS ships Apple's openrsync,
# so no GNU-only options (--info=progress2 etc.).
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${AIDE_DASH_HOST:-rw-macmini-m2}"
DEST="${AIDE_DASH_DEST:-aide-dashboard/site}"

if [ ! -f out/index.html ]; then
  echo "out/index.html missing — run 'make generate' first" >&2
  exit 1
fi

# shellcheck disable=SC2029  # client-side expansion of DEST is intended
ssh "$HOST" "mkdir -p '$DEST'"
rsync -az out/index.html "$HOST:$DEST/"
echo "published to $HOST:$DEST/index.html"
