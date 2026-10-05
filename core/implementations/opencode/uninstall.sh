#!/usr/bin/env bash

# uninstall.sh - Removes the OpenCode configuration installed by install.sh
# This reverses all changes made by install.sh

set -e  # Exit on error

echo "🗑️  OpenCode Uninstall"
echo "======================"
echo ""

OPENCODE_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

echo "⚠️  This will remove:"
echo "   - $OPENCODE_CONFIG/AGENTS.md"
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

if [ -f "$OPENCODE_CONFIG/AGENTS.md" ]; then
  rm "$OPENCODE_CONFIG/AGENTS.md"
  echo "   ✅ Removed: $OPENCODE_CONFIG/AGENTS.md"
else
  echo "   ℹ️  Not present: $OPENCODE_CONFIG/AGENTS.md"
fi

echo ""
echo "✅ OpenCode uninstall complete"
