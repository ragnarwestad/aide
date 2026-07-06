#!/usr/bin/env bash
# Installs doc-aide for ALL AI tools.
#
# Runs each implementations/<ai>/install.sh. Each one is self-contained and
# installs the shared scripts (core/scripts) + its own AI-specific setup.
# The shared scripts are therefore copied multiple times — that is cheap and intentional.
#
# If you only want to install one AI, run its script directly, e.g.:
#   implementations/codex/install.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🔧 doc-aide — installing all AI tools"
echo "============================================="

status=0
for ai in claude-code copilot codex; do
  echo ""
  echo "═══════ $ai ═══════"
  if "$ROOT/implementations/$ai/install.sh"; then
    echo "✅ $ai done"
  else
    echo "⚠️  $ai failed (continuing)"
    status=1
  fi
done

echo ""
if [ "$status" -eq 0 ]; then
  echo "✅ All installed."
else
  echo "⚠️  One or more failed — see the log above."
fi
exit "$status"
