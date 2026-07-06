#!/usr/bin/env bash

# uninstall.sh - Removes GitHub Copilot configuration installed by install.sh
# Reverses EXACTLY what install.sh does — no more, no less.

set -e  # Exit on error

echo "🗑️  GitHub Copilot Uninstall"
echo "============================"
echo ""

# Confirm uninstallation
echo "⚠️  This will remove:"
echo "   - Scripts from ~/.local/bin/ (aide-generate-pdf, aide-generate-html, mise-upgrade-ai-tools)"
echo "   - ~/.copilot/copilot-instructions.md"
echo ""
read -p "Are you sure you want to continue? [y/N]: " CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo ""
  echo "❌ Aborted"
  exit 0
fi

echo ""

# 1. Remove scripts from ~/.local/bin/
echo "1️⃣  Removing scripts from ~/.local/bin/..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
source "$WORKSPACE_ROOT/core/scripts/_install-bin.sh"
uninstall_common_bin

echo ""

# 2. Remove global Copilot instructions
echo "2️⃣  Removing global Copilot instructions..."

if [ -f "$HOME/.copilot/copilot-instructions.md" ]; then
  rm "$HOME/.copilot/copilot-instructions.md"
  echo "   ✅ Removed: ~/.copilot/copilot-instructions.md"
else
  echo "   ⏭️  Did not exist: ~/.copilot/copilot-instructions.md"
fi

echo ""

echo "✅ Uninstallation complete!"
echo ""
echo "💡 To reinstall, run:"
echo "   cd implementations/copilot"
echo "   ./install.sh"
