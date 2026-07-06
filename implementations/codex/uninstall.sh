#!/usr/bin/env bash

# uninstall.sh - Removes the OpenAI Codex configuration installed by install.sh
# This reverses all changes made by install.sh

set -e  # Exit on error

echo "🗑️  OpenAI Codex Uninstall"
echo "=========================="
echo ""

# Codex is global — no project path needed

# Confirm uninstallation
echo "⚠️  This will remove:"
echo "   - Scripts from ~/.local/bin/ (aide-generate-*, mise-upgrade-ai-tools, codex-aide-*)"
echo "   - ~/.codex/AGENTS.md"
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

# Codex-specific CLI wrappers (installed by install.sh)
for script in codex-aide-create codex-aide-analyze codex-aide-implement; do
  if [ -f "$HOME/.local/bin/$script" ]; then
    rm "$HOME/.local/bin/$script"
    echo "   ✅ Removed: ~/.local/bin/$script"
  fi
done

echo ""

# 2. Remove global Codex instructions
echo "2️⃣  Removing global Codex instructions..."

if [ -f "$HOME/.codex/AGENTS.md" ]; then
  rm "$HOME/.codex/AGENTS.md"
  echo "   ✅ Removed: ~/.codex/AGENTS.md"
else
  echo "   ⏭️  Did not exist: ~/.codex/AGENTS.md"
fi

echo ""

# 3. Information about manual steps
echo "3️⃣  Manual cleanup (optional)..."
echo ""
echo "   The following must be removed manually if desired:"
echo ""
echo "   Codex CLI:"
echo "      npm uninstall -g @openai/codex"
echo "      # or"
echo "      mise uninstall npm:@openai/codex"
echo ""
echo "   Codex config:"
echo "      rm -rf ~/.codex"
echo ""
echo "   Environment variables (in ~/.zshrc or ~/.bashrc):"
echo "      export AIDE_PROJECTS_PATH=..."
echo "      export AIDE_INSTALLATION_PATH=..."
echo "      export OPENAI_API_KEY=..."
echo ""
echo "   JIRA token:"
echo "      rm ~/.jira_token"
echo ""

echo "✅ Uninstallation complete!"
echo ""
echo "💡 To reinstall, run:"
echo "   cd implementations/codex"
echo "   ./install.sh"
