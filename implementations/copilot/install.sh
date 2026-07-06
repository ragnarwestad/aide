#!/usr/bin/env bash

# install.sh - Installs GitHub Copilot configuration globally
#
# Global (~/.copilot/): copilot-instructions.md
# Global (~/.local/bin/): scripts

set -e  # Exit on error

echo "🔧 GitHub Copilot Setup"
echo "======================="
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

# 1. Install scripts to ~/.local/bin/
echo "1️⃣  Installing scripts to ~/.local/bin/..."
source "$WORKSPACE_ROOT/core/scripts/_install-bin.sh"
install_common_bin

echo ""

# 2. Install AGENTS.md as global Copilot instructions
echo "2️⃣  Installing global Copilot instructions..."

if [ ! -f "$WORKSPACE_ROOT/core/AGENTS.md" ]; then
  echo "   ❌ core/AGENTS.md not found!"
  echo "   Run core/scripts/build-agents-md.sh first, or make sure you have the latest version: git pull"
  exit 1
fi

mkdir -p "$HOME/.copilot"
cp "$WORKSPACE_ROOT/core/AGENTS.md" "$HOME/.copilot/copilot-instructions.md"
echo "   ✅ Installed: ~/.copilot/copilot-instructions.md"
echo ""

# Verify that ~/.local/bin is in PATH
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

# 4. Check if the GitHub Copilot extension is installed
echo "4️⃣  Checking GitHub Copilot extension..."

if command -v code &> /dev/null; then
  if code --list-extensions | grep -q "github.copilot"; then
    echo "   ✅ GitHub Copilot extension is installed"
  else
    echo "   ⚠️  GitHub Copilot extension is NOT installed"
    echo ""
    echo "   Install the extensions:"
    echo "      code --install-extension GitHub.copilot"
    echo "      code --install-extension GitHub.copilot-chat"
    echo ""
  fi
else
  echo "   ⚠️  'code' command not found (VS Code CLI)"
  echo "   💡 Install from VS Code: Cmd+Shift+P → 'Shell Command: Install 'code' command in PATH'"
  echo ""
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Installed globally:"
echo "   ~/.copilot/copilot-instructions.md  (rules for Copilot)"
echo "   ~/.local/bin/                       (scripts)"
echo ""
echo "💡 Tips:"
echo "   - Update: Run ./install.sh again"
echo "   - Update rules: Edit core/rules/, run core/scripts/build-agents-md.sh, then ./install.sh"
echo "   - Restart VS Code after updating"
echo ""
