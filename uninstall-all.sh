#!/usr/bin/env bash
# Uninstalls doc-aide for ALL AI tools.
#
# Runs each implementations/<ai>/uninstall.sh. Each one asks for its own
# confirmation before deleting anything.
#
# If you only want to uninstall one AI, run its script directly, e.g.:
#   implementations/codex/uninstall.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🗑️  doc-aide — uninstalling all AI tools"
echo "==============================================="

status=0
for ai in claude-code copilot codex gemini; do
  echo ""
  echo "═══════ $ai ═══════"
  if "$ROOT/implementations/$ai/uninstall.sh"; then
    echo "✅ $ai done"
  else
    echo "⚠️  $ai failed (continuing)"
    status=1
  fi
done

echo ""
if [ "$status" -eq 0 ]; then
  echo "✅ All uninstalled."
else
  echo "⚠️  One or more failed — see the log above."
fi
exit "$status"
