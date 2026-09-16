#!/usr/bin/env bash

# install.sh - Installs OpenCode configuration for the aide workspace
# This sets up global instructions and shared CLI scripts

set -e  # Exit on error

echo "🔧 OpenCode Setup"
echo "================="
echo ""

# OpenCode is installed globally (~/.config/opencode/) — no project path needed

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WORKSPACE_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

if [ ! -d "$WORKSPACE_ROOT" ]; then
  echo "❌ Could not find workspace: $WORKSPACE_ROOT"
  exit 1
fi

echo "📂 Workspace: $WORKSPACE_ROOT"
echo ""

# Preflight: report what is installed and where the pieces will land
AIDE_INSTALLING=1 "$WORKSPACE_ROOT/core/scripts/aide-preflight" opencode

# 1. Install scripts to ~/.local/bin/
echo "1️⃣  Installing scripts to ~/.local/bin/..."
source "$WORKSPACE_ROOT/core/scripts/_install-bin.sh"
install_common_bin
install_mise_declared_tools
install_shell_path

echo ""

# 2. Install global opencode instructions (AGENTS.md)
echo "2️⃣  Installing global OpenCode instructions..."

if [ ! -f "$WORKSPACE_ROOT/core/AGENTS.md" ]; then
  echo "   ❌ core/AGENTS.md not found!"
  echo "   Run core/scripts/build-agents-md.sh first, or make sure you have the latest version: git pull"
  exit 1
fi

OPENCODE_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
mkdir -p "$OPENCODE_CONFIG"
cp "$WORKSPACE_ROOT/core/AGENTS.md" "$OPENCODE_CONFIG/AGENTS.md"
echo "   ✅ Installed: $OPENCODE_CONFIG/AGENTS.md"

echo ""

# 3. Skills: nothing to do
#
# OpenCode scans ~/.agents/skills and ~/.claude/skills for SKILL.md
# itself, which is where the other installers already put aide's skills.
# Installing a third copy would give the same skill two locations and
# OpenCode drops the duplicate, so this step exists to say that the
# absence is deliberate.
echo "3️⃣  Skills..."
echo "   ✅ Nothing to install: OpenCode reads ~/.agents/skills and ~/.claude/skills itself"

echo ""

# 4. Verify that ~/.local/bin is in PATH
echo "4️⃣  Verifying PATH..."
if [[ ":$PATH:" == *":$HOME/.local/bin:"* ]]; then
  echo "   ✅ ~/.local/bin is in PATH"
else
  echo "   ⚠️  ~/.local/bin is NOT in PATH for this shell yet"
  echo "   ℹ️  It was just added to ~/.zshenv and ~/.bashrc — open a new"
  echo "      terminal or ssh session to pick it up"
fi

echo ""

# 5. Check if opencode is installed
echo "5️⃣  Checking OpenCode..."

if command -v opencode &> /dev/null; then
  echo "   ✅ OpenCode is installed: $(opencode --version 2>/dev/null || echo 'version unknown')"
else
  echo "   ⚠️  OpenCode is NOT installed"
  echo ""
  echo "   Install via mise:"
  echo "      mise use -g opencode@latest"
  echo ""
fi

echo ""

# 6. Check that a provider is logged in
#
# OpenCode reaches every model through a provider, and has none
# configured until one is. A run with no credentials fails at the
# model, not at the setup, so it is worth saying here.
echo "6️⃣  Checking providers..."
if command -v opencode &> /dev/null && opencode providers list 2>/dev/null | grep -q "0 credentials"; then
  echo "   ⚠️  No provider is logged in — run: opencode providers login"
else
  echo "   ✅ At least one provider is configured"
fi

echo ""
echo "✅ OpenCode setup complete"
