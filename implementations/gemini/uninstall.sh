#!/usr/bin/env bash

# uninstall.sh - Removes the Google Gemini CLI configuration installed by install.sh
# This reverses all changes made by install.sh

set -e  # Exit on error

echo "🗑️  Google Gemini CLI Uninstall"
echo "==============================="
echo ""

# Gemini is global — no project path needed

# Confirm uninstallation
echo "⚠️  This will remove:"
echo "   - Scripts from ~/.local/bin/ (aide-generate-*, mise-upgrade-ai-tools)"
echo "   - ~/.gemini/GEMINI.md"
echo "   - ~/.gemini/commands/aide-*.toml"
echo ""
read -p "Are you sure you want to continue? [y/N]: " CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo ""
  echo "❌ Aborted"
  exit 0
fi

echo ""

# 1. Remove scripts from ~/.local/bin/
echo "1️⃣  Removing scripts from ~/.local/bin/..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
source "$WORKSPACE_ROOT/core/scripts/_install-bin.sh"
uninstall_common_bin

echo ""

# 2. Remove global Gemini configuration
echo "2️⃣  Removing global Gemini configuration..."

if [ -f "$HOME/.gemini/GEMINI.md" ]; then
  rm "$HOME/.gemini/GEMINI.md"
  echo "   ✅ Removed: ~/.gemini/GEMINI.md"
else
  echo "   ⏭️  Did not exist: ~/.gemini/GEMINI.md"
fi

if [ -d "$HOME/.gemini/commands" ]; then
  rm -f "$HOME/.gemini/commands/"aide-*.toml
  echo "   ✅ Removed: ~/.gemini/commands/aide-*.toml"
fi

echo ""

# 3. Information about manual steps
echo "3️⃣  Manual cleanup (optional)..."
echo ""
echo "   The following must be removed manually if desired:"
echo ""
echo "   Gemini CLI:"
echo "      npm uninstall -g @google/gemini-cli"
echo "      # or"
echo "      mise uninstall npm:@google/gemini-cli"
echo ""
echo "   Gemini config:"
echo "      rm -rf ~/.gemini"
echo ""
echo "   Environment variables (in ~/.zshrc or ~/.bashrc):"
echo "      export AIDE_PROJECTS_PATH=..."
echo "      export AIDE_INSTALLATION_PATH=..."
echo ""
echo "   JIRA token:"
echo "      rm ~/.jira_token"
echo ""

echo "✅ Uninstallation complete!"
echo ""
echo "💡 To reinstall, run:"
echo "   cd implementations/gemini"
echo "   ./install.sh"
