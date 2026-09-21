#!/usr/bin/env bash
# Installs aide for ALL AI tools.
#
# Runs each implementations/<ai>/install.sh. Each one is self-contained and
# installs the shared scripts (core/scripts) + its own AI-specific setup.
# The shared scripts are therefore copied multiple times — that is cheap and intentional.
#
# Before them it checks what they need and do not install themselves:
# mise with a node, and an AI tool's CLI. Nothing of that is installed for
# you — a missing piece is reported with the command that installs it.
#
# If you only want to install one AI, run its script directly, e.g.:
#   implementations/codex/install.sh
#   implementations/opencode/install.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🔧 aide — installing all AI tools"
echo "============================================="

status=0

echo ""
echo "═══════ prerequisites ═══════"
source "$ROOT/core/scripts/_install-prerequisites.sh"
# A missing prerequisite does not stop the installers: each one says what it
# skipped without mise (install_mise_declared_tools) and installs the rest.
check_prerequisites || status=1

# Nothing asks: an installer that would, run from here, takes its default.
# Run one directly to be asked.
for ai in claude-code copilot codex opencode; do
  echo ""
  echo "═══════ $ai ═══════"
  if "$ROOT/implementations/$ai/install.sh" < /dev/null; then
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
