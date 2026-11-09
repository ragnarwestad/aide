#!/usr/bin/env bash

# install.sh - Installs GitHub Copilot configuration globally
#
# Global (~/.copilot/): copilot-instructions.md
# Global (~/.local/bin/): scripts

set -e  # Exit on error

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../../scripts/_install-steps.sh"
install_steps_begin copilot

# 2. Install AGENTS.md as global Copilot instructions
echo "2️⃣  Installing global Copilot instructions..."

install_instructions "$HOME/.copilot/copilot-instructions.md"
echo ""

# 3. Install skills to ~/.agents/skills/ — the Copilot CLI reads its personal
#    skills from there, NOT ~/.claude/skills/ (verified against 1.0.79).
#    Shared with Codex — see core/scripts/_install-skills.sh.
echo "3️⃣  Installing skills to ~/.agents/skills/..."

install_skills "$HOME/.agents/skills"

echo ""

install_steps_finish copilot

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Installed globally:"
echo "   ~/.copilot/copilot-instructions.md  (rules for Copilot)"
echo "   ~/.agents/skills/                   (skills, shared with Codex)"
echo "   ~/.local/bin/                       (scripts)"
echo ""
echo "💡 Tips:"
echo "   - Update: Run ./install.sh again"
echo "   - Update rules: Edit core/rules/, run core/scripts/build-agents-md.sh, then ./install.sh"
echo ""
