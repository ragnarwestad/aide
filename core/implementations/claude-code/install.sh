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

# An agent no skill calls any more, left by an earlier install
if [ -f "$GLOBAL_CLAUDE/agents/task-analyzer.md" ]; then
  rm "$GLOBAL_CLAUDE/agents/task-analyzer.md"
  echo "   🗑️  Removed old: ~/.claude/agents/task-analyzer.md"
fi

# Generic rules. This includes the rules that apply to every turn plus
# spec-structure, whose `paths` frontmatter limits where Claude loads it.
source "$WORKSPACE_ROOT/core/scripts/_install-rules.sh"
install_rules "$GLOBAL_CLAUDE/rules"
echo "   ✅ Rules installed: ~/.claude/rules/"

# Migrate rules retired before rule manifests were installed.
for retired in tools-and-scripts workflows documentation markdown-linting; do
  if [ -f "$GLOBAL_CLAUDE/rules/$retired.md" ]; then
    rm "$GLOBAL_CLAUDE/rules/$retired.md"
    echo "   🗑️  Removed retired rule: ~/.claude/rules/$retired.md (now a skill)"
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
