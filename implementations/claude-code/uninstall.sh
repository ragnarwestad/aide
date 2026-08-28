#!/usr/bin/env bash

# uninstall.sh - Removes the Claude Code configuration installed by install.sh
# Reverses EXACTLY what install.sh does — no more, no less.

set -e  # Exit on error

echo "🗑️  Claude Code Uninstall"
echo "========================="
echo ""

# Confirm uninstallation
echo "⚠️  This will remove:"
echo "   - Skills from ~/.claude/skills/ (15 named directories)"
echo "   - Agents from ~/.claude/agents/ (task-analyzer.md)"
echo "   - Rules from ~/.claude/rules/ (5 named files)"
echo "   - ~/.claude/docs/ and ~/.claude/api-mapping/ (legacy)"
echo ""
read -p "Are you sure you want to continue? [y/N]: " CONFIRM

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

# 2. Remove old docs and api-mapping from ~/.claude/ (consolidated into skills)
echo "2️⃣  Removing old docs and api-mapping from ~/.claude/..."

for old_dir in docs api-mapping; do
  if [ -d "$HOME/.claude/$old_dir" ]; then
    rm -rf "$HOME/.claude/$old_dir"
    echo "   ✅ Removed: ~/.claude/$old_dir/"
  else
    echo "   ⏭️  Did not exist: ~/.claude/$old_dir/"
  fi
done

echo ""

# 4. Remove skills from ~/.claude/skills/
echo "4️⃣  Removing skills from ~/.claude/skills/..."

SKILLS=(
  "aide-analyze"
  "aide-archive"
  "aide-explore"
  "aide-reopen"
  "aide-reset"
  "aide-manifest"
  "aide-implement"
  "aide-create"
  "aide-to-pdf"
  "task-workflow-assistant"
  "tdd-coach"
  "documentation"
  "markdown-linting"
  "tools-and-scripts"
  "workflows"
  "playwright-e2e"
  "unit-tests"
)

for skill in "${SKILLS[@]}"; do
  if [ -d "$HOME/.claude/skills/$skill" ]; then
    rm -rf "$HOME/.claude/skills/$skill"
    echo "   ✅ Removed: ~/.claude/skills/$skill"
  else
    echo "   ⏭️  Did not exist: ~/.claude/skills/$skill"
  fi
done

# And whatever the last install actually put there (spec 142). The list
# above is a snapshot of what is shipped TODAY, and a name leaves it in
# the same commit that stops shipping the skill — which is exactly when
# removing the installed copy starts to matter. The manifest is the
# record that snapshot cannot be, and it lives on THIS machine, so it
# names what this machine actually has.
#
# Spelled out rather than sourced from core/scripts/_install-skills.sh:
# this script sources nothing, and pinning the two spellings to each
# other is what test_core_skills.py does.
MANIFEST="$HOME/.claude/skills/.aide-installed-manifest"
if [ -f "$MANIFEST" ]; then
  while IFS= read -r skill; do
    # A skill name is a directory name and nothing else: this is an
    # `rm -rf` driven by a file.
    case "$skill" in
      "" | .* | */*) continue ;;
    esac
    if [ -d "$HOME/.claude/skills/$skill" ]; then
      rm -rf "$HOME/.claude/skills/$skill"
      echo "   ✅ Removed: ~/.claude/skills/$skill"
    fi
  done < "$MANIFEST"
  rm -f "$MANIFEST"
  echo "   ✅ Removed: ~/.claude/skills/.aide-installed-manifest"
fi

echo ""

# 5. Remove old commands from ~/.claude/commands/ (migrated to skills)
echo "5️⃣  Removing old commands from ~/.claude/commands/..."

if [ -d "$HOME/.claude/commands" ]; then
  rm -rf "$HOME/.claude/commands"
  echo "   ✅ Removed: ~/.claude/commands/ (consolidated into skills)"
else
  echo "   ⏭️  ~/.claude/commands/ did not exist"
fi

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

RULES=(
  "llm-discipline.md"
  "git.md"
  "testing.md"
  "spec-structure.md"
  "communication.md"
)

for rule in "${RULES[@]}"; do
  if [ -f "$HOME/.claude/rules/$rule" ]; then
    rm "$HOME/.claude/rules/$rule"
    echo "   ✅ Removed: ~/.claude/rules/$rule"
  else
    echo "   ⏭️  Did not exist: ~/.claude/rules/$rule"
  fi
done

echo ""

echo "✅ Uninstall complete!"
echo ""
echo "💡 To reinstall:"
echo "   cd $(dirname "$0")"
echo "   ./install.sh"
echo ""
