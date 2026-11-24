#!/usr/bin/env bash

# uninstall.sh - Removes the Claude Code configuration installed by install.sh
# Reverses EXACTLY what install.sh does — no more, no less.

set -e  # Exit on error
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
source "$WORKSPACE_ROOT/core/scripts/_install-skills.sh"
source "$WORKSPACE_ROOT/core/scripts/_install-rules.sh"
source "$WORKSPACE_ROOT/core/scripts/_install-hooks.sh"

echo "🗑️  Claude Code Uninstall"
echo "========================="
echo ""

# Confirm uninstallation
echo "⚠️  This will remove:"
echo "   - Skills recorded in ~/.claude/skills/$AIDE_SKILL_MANIFEST_NAME"
echo "   - Agents from ~/.claude/agents/ (task-analyzer.md)"
echo "   - Rules recorded in ~/.claude/rules/$AIDE_RULE_MANIFEST_NAME"
echo "   - aide's command-rule hooks from ~/.claude/settings.json (the rest of the file is kept)"
echo ""
read -r -p "Are you sure you want to continue? [y/N]: " CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo ""
  echo "❌ Aborted"
  exit 0
fi

echo ""

# 1. Shared scripts in ~/.local/bin are kept (other AI tools use them).
#    They are only removed by uninstall-all.sh.
echo "1️⃣  Keeping shared scripts in ~/.local/bin/ (removed only by uninstall-all.sh)"

echo ""

# 4. Remove skills from ~/.claude/skills/
echo "4️⃣  Removing skills from ~/.claude/skills/..."

uninstall_skills "$HOME/.claude/skills"

echo ""

# 6. Remove agents from ~/.claude/agents/
echo "6️⃣  Removing agents from ~/.claude/agents/..."

if [ -f "$HOME/.claude/agents/task-analyzer.md" ]; then
  rm "$HOME/.claude/agents/task-analyzer.md"
  echo "   ✅ Removed: ~/.claude/agents/task-analyzer.md"
else
  echo "   ⏭️  Did not exist: ~/.claude/agents/task-analyzer.md"
fi

echo ""

# 7. Remove rules from ~/.claude/rules/
echo "7️⃣  Removing rules from ~/.claude/rules/..."

uninstall_rules "$HOME/.claude/rules"

echo ""

# 8. Remove aide's hooks from ~/.claude/settings.json
echo "8️⃣  Removing aide's hooks from ~/.claude/settings.json..."

uninstall_aide_hooks "$SCRIPT_DIR/hooks.json" "$HOME/.claude/settings.json" \
  "$AIDE_HOOKS_PATTERN_CLAUDE"

echo ""

echo "✅ Uninstall complete!"
echo ""
echo "💡 To reinstall:"
echo "   cd $(dirname "$0")"
echo "   ./install.sh"
echo ""
