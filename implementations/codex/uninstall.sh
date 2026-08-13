#!/usr/bin/env bash

# uninstall.sh - Removes the OpenAI Codex configuration installed by install.sh
# This reverses all changes made by install.sh

set -e  # Exit on error

echo "🗑️  OpenAI Codex Uninstall"
echo "=========================="
echo ""

# Codex is global — no project path needed

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Confirm uninstallation
echo "⚠️  This will remove:"
echo "   - ~/.codex/AGENTS.md"
echo "   - ~/.codex/hooks.json (if unchanged) + ~/.codex/hooks/aide-*.sh"
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

# 2. Remove global Codex instructions
echo "2️⃣  Removing global Codex instructions..."

if [ -f "$HOME/.codex/AGENTS.md" ]; then
  rm "$HOME/.codex/AGENTS.md"
  echo "   ✅ Removed: ~/.codex/AGENTS.md"
else
  echo "   ⏭️  Did not exist: ~/.codex/AGENTS.md"
fi

echo ""

# 3. Remove Codex hooks
echo "3️⃣  Removing Codex hooks..."

if [ -f "$HOME/.codex/hooks.json" ]; then
  if cmp -s "$SCRIPT_DIR/hooks/hooks.json" "$HOME/.codex/hooks.json"; then
    rm "$HOME/.codex/hooks.json"
    echo "   ✅ Removed: ~/.codex/hooks.json"
  else
    echo "   ⚠️  ~/.codex/hooks.json differs from aide's — left in place"
  fi
else
  echo "   ⏭️  Did not exist: ~/.codex/hooks.json"
fi

rm -f "$HOME/.codex/hooks/"aide-*.sh
echo "   ✅ Removed: ~/.codex/hooks/aide-*.sh"

echo ""

# 4. Information about manual steps
echo "4️⃣  Manual cleanup (optional)..."
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
