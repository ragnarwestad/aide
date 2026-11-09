#!/usr/bin/env bash

# install.sh - Installs OpenCode configuration for the aide workspace
# This sets up global instructions and shared CLI scripts

set -e  # Exit on error

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../../scripts/_install-steps.sh"
install_steps_begin opencode

# 2. Install global opencode instructions (AGENTS.md)
echo "2️⃣  Installing global OpenCode instructions..."

OPENCODE_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
install_instructions "$OPENCODE_CONFIG/AGENTS.md"

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

install_steps_finish opencode

echo ""

# 6. Check that a provider is logged in
echo "6️⃣  Checking providers..."
source "$SCRIPT_DIR/_login-check.sh"
report_opencode_login

echo ""
echo "✅ OpenCode setup complete"
