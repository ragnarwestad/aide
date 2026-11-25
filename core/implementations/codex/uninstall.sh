#!/usr/bin/env bash

# uninstall.sh - Removes the OpenAI Codex configuration installed by install.sh
# This reverses all changes made by install.sh

set -e  # Exit on error

echo "🗑️  OpenAI Codex Uninstall"
echo "=========================="
echo ""

# Codex is global — no project path needed

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/lib/doc-fallback.sh"
source "$SCRIPT_DIR/../../scripts/_install-hooks.sh"
source "$SCRIPT_DIR/../../scripts/_install-instructions.sh"
source "$SCRIPT_DIR/../../scripts/_uninstall-confirm.sh"

# Confirm uninstallation
echo "⚠️  This will remove:"
echo "   - aide's rules from ~/.codex/AGENTS.md (your own text there is kept)"
echo "   - project_doc_fallback_filenames in ~/.codex/config.toml (if the installer wrote it)"
echo "   - aide's hooks from ~/.codex/hooks.json (your own hooks are kept) + ~/.codex/hooks/aide-*.sh"
aide_confirm_or_abort

# 1. Shared scripts in ~/.local/bin are kept (other AI tools use them).
#    They are only removed by uninstall-all.sh.
echo "1️⃣  Keeping shared scripts in ~/.local/bin/ (removed only by uninstall-all.sh)"

echo ""

# 2. Remove global Codex instructions
echo "2️⃣  Removing global Codex instructions..."

uninstall_instructions "$HOME/.codex/AGENTS.md"
uninstall_codex_doc_fallback "$HOME/.codex/config.toml"

echo ""

# 3. Remove Codex hooks
echo "3️⃣  Removing Codex hooks..."

uninstall_aide_hooks "$SCRIPT_DIR/hooks/hooks.json" "$HOME/.codex/hooks.json" \
  "$AIDE_HOOKS_PATTERN_CODEX"

rm -f "$HOME/.codex/hooks/"aide-*.sh
echo "   ✅ Removed: ~/.codex/hooks/aide-*.sh"

echo ""

# 4. Skills in ~/.agents/skills are kept (Copilot reads them too).
#    They are only removed by uninstall-all.sh.
echo "4️⃣  Keeping skills in ~/.agents/skills/ (removed only by uninstall-all.sh)"

echo ""

# 5. Information about manual steps
echo "5️⃣  Manual cleanup (optional)..."
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

echo "✅ Uninstallation complete!"
echo ""
echo "💡 To reinstall, run:"
echo "   cd core/implementations/codex"
echo "   ./install.sh"
