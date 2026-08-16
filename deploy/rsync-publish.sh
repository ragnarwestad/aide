#!/bin/bash
# Publish the out/ site directory to the mac mini's serve directory.
# Directory sync WITH --delete: stale pages disappear on publish.
# openrsync-compatible flags only — macOS ships Apple's openrsync,
# so no GNU-only options (--info=progress2 etc.).
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${AIDE_DASH_HOST:-rw-macmini-m2}"
DEST="${AIDE_DASH_DEST:-aide-dashboard/site}"

if [ ! -f out/index.html ]; then
  echo "out/index.html missing — run 'make generate' first" >&2
  echo "(refusing to sync an empty out/ with --delete: it would wipe the site)" >&2
  exit 1
fi

# shellcheck disable=SC2029  # client-side expansion of DEST is intended
ssh "$HOST" "mkdir -p '$DEST'"
rsync -az --delete out/ "$HOST:$DEST/"
echo "published out/ to $HOST:$DEST/ (with --delete)"
