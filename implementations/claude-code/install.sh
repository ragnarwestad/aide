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
# Claude Code has its own skills location and its own copy step below,
# but the pruning half is shared with the other two installers — one
# implementation, three call sites.
source "$WORKSPACE_ROOT/core/scripts/_install-skills.sh"

echo ""

# 2. Install globally to ~/.claude/ (skills, agents, rules)
echo "2️⃣  Installing globally to ~/.claude/..."

GLOBAL_CLAUDE="$HOME/.claude"
mkdir -p "$GLOBAL_CLAUDE/skills" "$GLOBAL_CLAUDE/agents" "$GLOBAL_CLAUDE/rules"

# Skills (copy without --delete to avoid deleting other tools' skills)
if [ -d "$WORKSPACE_ROOT/core/skills" ]; then
  # spec-structure is generated for Codex/Copilot's ~/.agents/skills/ only
  # (spec 147). Claude Code already has that content as a path-scoped rule,
  # core/rules/spec-structure.md, and a second model-triggered copy of the
  # same guidance would only compete with it.
  rsync -a --exclude='spec-structure/' "$WORKSPACE_ROOT/core/skills/" "$GLOBAL_CLAUDE/skills/"
  # ...and the half that subtracts (spec 142). The rsync above may not
  # use --delete — ~/.claude/skills/ is allowed to hold skills aide
  # never put there — so a skill dropped from core/skills/ would sit
  # here for good. The manifest names what the LAST install shipped, so
  # what left the source since is known and can go.
  prune_retired_skills "$WORKSPACE_ROOT/core/skills" "$GLOBAL_CLAUDE/skills" \
    "$GLOBAL_CLAUDE/skills/$AIDE_SKILL_MANIFEST_NAME"
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
# The rules that apply to every turn, plus spec-structure, which is copied
# here but loaded only for spec files (its `paths` frontmatter). The four
# task-specific ones became skills in spec 147.
GENERIC_RULES="llm-discipline git testing spec-structure communication"
for rule in $GENERIC_RULES; do
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
echo "📡 Optional: link sessions to aide specs (aide-dashboard, spec 80)"
echo "   aide never edits ~/.claude/settings.json. To emit one small event per"
echo "   /aide-* command to your aide-dashboard, paste this into the \"hooks\""
echo "   section of ~/.claude/settings.json and set AIDE_RUN_URL to your"
echo "   dashboard's /api/aide-run (leave it empty to keep the hook inert):"
echo ""
echo "   \"UserPromptSubmit\": [{ \"hooks\": [{ \"type\": \"command\","
echo "     \"command\": \"AIDE_RUN_URL=\\\"https://<serving-host>.<tailnet>.ts.net/api/aide-run\\\" '$HOME/.local/bin/aide-emit-run'\" }] }]"
echo ""
echo "💡 Tips:"
echo "   - Update: Run ./install.sh again"
echo "   - Restart Claude Code after updating"
echo ""
