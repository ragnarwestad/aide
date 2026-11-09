#!/usr/bin/env bash

# install.sh - Installs Claude Code configuration globally
#
# Global (~/.claude/): skills, agents, rules
# Global (~/.local/bin/): scripts

set -e  # Exit on error

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../../scripts/_install-steps.sh"

IMPL_DIR="$SCRIPT_DIR"

install_steps_begin claude

# 2. Install globally to ~/.claude/ (skills, agents, rules)
echo "2️⃣  Installing globally to ~/.claude/..."

GLOBAL_CLAUDE="$HOME/.claude"
mkdir -p "$GLOBAL_CLAUDE/skills" "$GLOBAL_CLAUDE/rules"

install_skills "$GLOBAL_CLAUDE/skills" spec-structure
echo "   ✅ Skills installed: ~/.claude/skills/"

# Migrate: remove old commands (now consolidated into skills)
if [ -d "$GLOBAL_CLAUDE/commands" ]; then
  rm -rf "$GLOBAL_CLAUDE/commands"
  echo "   🗑️  Removed old: ~/.claude/commands/ (consolidated into skills)"
fi

# An agent no skill calls any more, left by an earlier install
if [ -f "$GLOBAL_CLAUDE/agents/task-analyzer.md" ]; then
  rm "$GLOBAL_CLAUDE/agents/task-analyzer.md"
  echo "   🗑️  Removed old: ~/.claude/agents/task-analyzer.md"
fi

# Generic rules
# The rules that apply to every turn, plus spec-structure, which is copied
# here but loaded only for spec files (its `paths` frontmatter). The four
# task-specific ones became skills in spec 147.
source "$WORKSPACE_ROOT/core/scripts/_install-rules.sh"
for rule in $(rule_names); do
  if [ -f "$WORKSPACE_ROOT/core/rules/$rule.md" ]; then
    cp "$WORKSPACE_ROOT/core/rules/$rule.md" "$GLOBAL_CLAUDE/rules/"
  fi
done
echo "   ✅ Rules installed: ~/.claude/rules/"

# Migrate: four rules became skills (spec 147). The loop above only ever
# ADDS the files still on the list — it never diffs against what an
# earlier install left behind, the way prune_retired_skills does on the
# skills side. Without this, a machine that installed before the change
# keeps loading the retired rule in every prompt AND gets the new skill:
# the resident footprint grows instead of shrinking.
for retired in tools-and-scripts workflows documentation markdown-linting; do
  if [ -f "$GLOBAL_CLAUDE/rules/$retired.md" ]; then
    rm "$GLOBAL_CLAUDE/rules/$retired.md"
    echo "   🗑️  Removed retired rule: ~/.claude/rules/$retired.md (now a skill)"
  fi
done

# Migrate: remove old docs/ and api-mapping/ (now consolidated into skills)
for old_dir in docs api-mapping; do
  if [ -d "$GLOBAL_CLAUDE/$old_dir" ]; then
    rm -rf "${GLOBAL_CLAUDE:?}/$old_dir"
    echo "   🗑️  Removed old: ~/.claude/$old_dir/ (consolidated into skills)"
  fi
done

echo ""

install_steps_finish claude

# 4. Install LSP plugins (native Claude Code)
echo "4️⃣  Installing LSP plugins..."

if command -v claude &> /dev/null; then
  for plugin in typescript-lsp kotlin-lsp jdtls-lsp; do
    if claude plugin install "${plugin}@claude-plugins-official" 2>/dev/null; then
      echo "   ✅ $plugin installed"
    else
      echo "   ⏭️  $plugin: already installed or not available"
    fi
  done
else
  echo "   ⚠️  Claude CLI not found - install LSP plugins manually:"
  echo "      claude plugin install typescript-lsp@claude-plugins-official"
  echo "      claude plugin install kotlin-lsp@claude-plugins-official"
  echo "      claude plugin install jdtls-lsp@claude-plugins-official"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Installed globally:"
echo "   ~/.claude/skills/          ($(find ~/.claude/skills -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ') skills)"
echo "   ~/.claude/rules/           ($(find ~/.claude/rules -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ') rules)"
echo "   ~/.local/bin/              (scripts)"
echo ""
echo "🔌 LSP plugins:"
echo "   - typescript-lsp, kotlin-lsp, jdtls-lsp"
echo ""
echo "💡 Tips:"
echo "   - Update: Run ./install.sh again"
echo "   - Restart Claude Code after updating"
echo ""
