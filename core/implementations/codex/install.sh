#!/usr/bin/env bash

# install.sh - Installs OpenAI Codex configuration for the aide workspace
# This sets up custom instructions and shared CLI scripts

set -e  # Exit on error

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../../scripts/_install-steps.sh"
source "$SCRIPT_DIR/lib/optional-mcp.sh"
source "$SCRIPT_DIR/lib/doc-fallback.sh"
source "$SCRIPT_DIR/lib/retired-hooks.sh"
source "$SCRIPT_DIR/../../scripts/_install-hooks.sh"
install_steps_begin codex

# 2. Install global Codex instructions (AGENTS.md)
echo "2️⃣  Installing global Codex instructions..."

install_instructions "$HOME/.codex/AGENTS.md"
install_codex_doc_fallback "$HOME/.codex/config.toml"

echo ""

# 3. Install Codex hooks: the shared command rules, and ports of the Claude Code hooks
echo "3️⃣  Installing Codex hooks..."

mkdir -p "$HOME/.codex/hooks"
install_aide_hooks "$SCRIPT_DIR/hooks/hooks.json" "$HOME/.codex/hooks.json" \
  "$AIDE_HOOKS_PATTERN_CODEX"
cp "$SCRIPT_DIR/hooks/"aide-*.sh "$HOME/.codex/hooks/"
chmod +x "$HOME/.codex/hooks/"aide-*.sh
remove_retired_codex_rules "$HOME/.codex/hooks" "$HOME/.codex/hooks.json"
echo "   ✅ Installed: ~/.codex/hooks.json + hook scripts in ~/.codex/hooks/"

if ! command -v jq &> /dev/null; then
  echo "   ⚠️  jq is NOT installed — the hooks need it (brew install jq)"
fi

echo ""

# 4. Install skills to ~/.agents/skills/ (Codex reads SKILL.md from there;
#    shared with Copilot — see core/scripts/_install-skills.sh)
echo "4️⃣  Installing skills to ~/.agents/skills/..."

install_skills "$HOME/.agents/skills"

echo ""

install_steps_finish codex

# 7. Check if Browser Testing MCP is configured
echo "7️⃣  Checking Browser Testing MCP (Playwright & Chrome DevTools)..."

CODEX_CONFIG_FILE="$HOME/.codex/config.toml"

offer_optional_mcp "$CODEX_CONFIG_FILE" "Browser Testing MCP" "Playwright and Chrome DevTools" \
  "playwright chrome-devtools" \
  "$SCRIPT_DIR/mcp/browser-testing.toml" \
  "$WORKSPACE_ROOT/core/implementations/codex/mcp/BROWSER_TESTING_MCP_SETUP.md" \
  "Playwright & Chrome DevTools provide:" \
  "- Browser automation (navigate, click, fill out forms)" \
  "- Generate E2E tests automatically" \
  "- Chrome DevTools debugging (Console, Network, Performance)" \
  "- Accessibility analysis"
BROWSER_MCP_INSTALLED=$MCP_CONFIGURED

# 8. Check if Context7 MCP is configured
echo "8️⃣  Checking Context7 MCP (Up-to-date documentation)..."

offer_optional_mcp "$CODEX_CONFIG_FILE" "Context7 MCP" "Context7" \
  "context7" \
  "$SCRIPT_DIR/mcp/context7.toml" \
  "$WORKSPACE_ROOT/core/implementations/codex/mcp/CONTEXT7_MCP_SETUP.md" \
  "Context7 provides:" \
  "- Up-to-date, version-specific documentation for libraries" \
  "- React, TypeScript, Spring Boot, etc." \
  "- Injects automatically into prompts with 'use context7'"
CONTEXT7_INSTALLED=$MCP_CONFIGURED

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Installed:"
echo "   ~/.codex/AGENTS.md"
echo "   ~/.codex/config.toml: project_doc_fallback_filenames (CLAUDE.md where a project has no AGENTS.md)"
echo "   ~/.codex/hooks.json + ~/.codex/hooks/aide-*.sh"
echo "   ~/.agents/skills/ (all core/skills/)"
echo ""
echo "📝 Next steps:"
echo "   1. Start Codex in a project:"
echo "      cd ~/develop/my-app"
echo "      codex"
echo ""
echo "💡 Tips:"
echo "   - Update configuration: Run ./install.sh again"
echo "   - Uninstall: ./uninstall.sh"
echo ""
if [ "$BROWSER_MCP_INSTALLED" = true ]; then
  echo "🌐 Browser Testing MCP:"
  echo "   ✅ Playwright MCP configured"
  echo "   ✅ Chrome DevTools MCP configured"
  echo "   💡 Browser automation and debugging available"
  echo "   📖 Read: $WORKSPACE_ROOT/core/implementations/codex/mcp/BROWSER_TESTING_MCP_SETUP.md"
  echo ""
fi
if [ "$CONTEXT7_INSTALLED" = true ]; then
  echo "📚 Context7 MCP:"
  echo "   ✅ Context7 MCP configured"
  echo "   💡 Up-to-date documentation for libraries available"
  echo "   💡 Use 'use context7' in prompts for up-to-date docs"
  echo "   📖 Read: $WORKSPACE_ROOT/core/implementations/codex/mcp/CONTEXT7_MCP_SETUP.md"
  echo ""
fi
echo "📚 Documentation:"
echo "   - $SCRIPT_DIR/README.md"
if [ "$BROWSER_MCP_INSTALLED" = true ]; then
  echo "   - $WORKSPACE_ROOT/core/implementations/codex/mcp/BROWSER_TESTING_MCP_SETUP.md"
fi
if [ "$CONTEXT7_INSTALLED" = true ]; then
  echo "   - $WORKSPACE_ROOT/core/implementations/codex/mcp/CONTEXT7_MCP_SETUP.md"
fi
echo ""
