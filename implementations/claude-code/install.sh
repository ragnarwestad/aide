#!/usr/bin/env bash

# install.sh - Installs Claude Code configuration globally
#
# Global (~/.claude/): skills, agents, rules
# Global (~/.local/bin/): scripts

set -e  # Exit on error

echo "🔧 Claude Code Setup"
echo "====================="
echo ""

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WORKSPACE_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Verify that the workspace exists
if [ ! -d "$WORKSPACE_ROOT" ]; then
  echo "❌ Could not find workspace: $WORKSPACE_ROOT"
  exit 1
fi

echo "📂 Workspace: $WORKSPACE_ROOT"
echo ""

IMPL_DIR="$SCRIPT_DIR"

# Preflight: report what is installed and where the pieces will land
"$WORKSPACE_ROOT/core/scripts/aide-preflight" claude

# 1. Install scripts to ~/.local/bin/
echo "1️⃣  Installing scripts to ~/.local/bin/..."
source "$WORKSPACE_ROOT/core/scripts/_install-bin.sh"
install_common_bin

echo ""

# 2. Install globally to ~/.claude/ (skills, agents, rules)
echo "2️⃣  Installing globally to ~/.claude/..."

GLOBAL_CLAUDE="$HOME/.claude"
mkdir -p "$GLOBAL_CLAUDE/skills" "$GLOBAL_CLAUDE/agents" "$GLOBAL_CLAUDE/rules"

# Skills (copy without --delete to avoid deleting other tools' skills)
if [ -d "$WORKSPACE_ROOT/core/skills" ]; then
  rsync -a "$WORKSPACE_ROOT/core/skills/" "$GLOBAL_CLAUDE/skills/"
  echo "   ✅ Skills installed: ~/.claude/skills/"
fi

# Migrate: remove old commands (now consolidated into skills)
if [ -d "$GLOBAL_CLAUDE/commands" ]; then
  rm -rf "$GLOBAL_CLAUDE/commands"
  echo "   🗑️  Removed old: ~/.claude/commands/ (consolidated into skills)"
fi

# Agents
if [ -d "$IMPL_DIR/agents" ]; then
  rsync -a "$IMPL_DIR/agents/" "$GLOBAL_CLAUDE/agents/"
  echo "   ✅ Agents installed: ~/.claude/agents/"
fi

# Generic rules
GENERIC_RULES="tools-and-scripts workflows llm-discipline git testing documentation markdown-linting spec-structure communication"
for rule in $GENERIC_RULES; do
  if [ -f "$WORKSPACE_ROOT/core/rules/$rule.md" ]; then
    cp "$WORKSPACE_ROOT/core/rules/$rule.md" "$GLOBAL_CLAUDE/rules/"
  fi
done
echo "   ✅ Rules installed: ~/.claude/rules/"

# Migrate: remove old docs/ and api-mapping/ (now consolidated into skills)
for old_dir in docs api-mapping; do
  if [ -d "$GLOBAL_CLAUDE/$old_dir" ]; then
    rm -rf "$GLOBAL_CLAUDE/$old_dir"
    echo "   🗑️  Removed old: ~/.claude/$old_dir/ (consolidated into skills)"
  fi
done

echo ""

# 3. Verify that ~/.local/bin is in PATH
echo "3️⃣  Verifying PATH..."
if [[ ":$PATH:" == *":$HOME/.local/bin:"* ]]; then
  echo "   ✅ ~/.local/bin is in PATH"
else
  echo "   ⚠️  ~/.local/bin is NOT in PATH"
  echo "   ℹ️  Add the following to ~/.zshrc or ~/.bashrc:"
  echo ""
  echo "      export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
fi

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
echo "   ~/.claude/skills/          ($(ls ~/.claude/skills/ 2>/dev/null | wc -l | tr -d ' ') skills)"
echo "   ~/.claude/rules/           ($(ls ~/.claude/rules/ 2>/dev/null | wc -l | tr -d ' ') rules)"
echo "   ~/.claude/agents/          (agents)"
echo "   ~/.local/bin/              (scripts)"
echo ""
echo "🔌 LSP plugins:"
echo "   - typescript-lsp, kotlin-lsp, jdtls-lsp"
echo ""
echo "💡 Tips:"
echo "   - Update: Run ./install.sh again"
echo "   - Restart Claude Code after updating"
echo ""
