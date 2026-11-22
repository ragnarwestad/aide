#!/usr/bin/env bash

# uninstall.sh - Removes the OpenCode configuration installed by install.sh
# This reverses all changes made by install.sh

set -e  # Exit on error

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../scripts/_install-instructions.sh"

echo "🗑️  OpenCode Uninstall"
echo "======================"
echo ""

OPENCODE_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

echo "⚠️  This will remove:"
echo "   - aide's rules from $OPENCODE_CONFIG/AGENTS.md (your own text there is kept)"
echo ""
echo "   It leaves the shared scripts in ~/.local/bin and the skills in"
echo "   ~/.agents/skills alone: other tools and the cron job depend on"
echo "   them, and only uninstall-all.sh removes those."
echo ""
read -r -p "Are you sure you want to continue? [y/N]: " CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo ""
  echo "❌ Aborted"
  exit 0
fi

echo ""

uninstall_instructions "$OPENCODE_CONFIG/AGENTS.md"

echo ""
echo "✅ OpenCode uninstall complete"
