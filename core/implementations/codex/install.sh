#!/usr/bin/env bash

# install.sh - Installs OpenAI Codex configuration for the aide workspace
# This sets up custom instructions and shared CLI scripts

set -e  # Exit on error

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../../scripts/_install-steps.sh"
install_steps_begin codex

# 2. Install global Codex instructions (AGENTS.md)
echo "2️⃣  Installing global Codex instructions..."

install_instructions "$HOME/.codex/AGENTS.md"

echo ""

# 3. Install Codex hooks (ports of the Claude Code hooks in settings.json)
echo "3️⃣  Installing Codex hooks..."

mkdir -p "$HOME/.codex/hooks"
if [ -f "$HOME/.codex/hooks.json" ] && ! cmp -s "$SCRIPT_DIR/hooks/hooks.json" "$HOME/.codex/hooks.json"; then
  cp "$HOME/.codex/hooks.json" "$HOME/.codex/hooks.json.bak"
  echo "   ⚠️  Existing ~/.codex/hooks.json differed — backed up to ~/.codex/hooks.json.bak"
fi
cp "$SCRIPT_DIR/hooks/hooks.json" "$HOME/.codex/hooks.json"
cp "$SCRIPT_DIR/hooks/"aide-*.sh "$HOME/.codex/hooks/"
chmod +x "$HOME/.codex/hooks/"aide-*.sh
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
BROWSER_MCP_INSTALLED=false

if [ -f "$CODEX_CONFIG_FILE" ]; then
  if grep -qF '[mcp_servers.playwright]' "$CODEX_CONFIG_FILE" && grep -qF '[mcp_servers.chrome-devtools]' "$CODEX_CONFIG_FILE"; then
    echo "   ✅ Playwright and Chrome DevTools MCP are already configured"
    BROWSER_MCP_INSTALLED=true
  fi
fi

if [ "$BROWSER_MCP_INSTALLED" = false ]; then
  echo "   ⚠️  Browser Testing MCP is NOT configured"
  echo ""
  echo "   Playwright & Chrome DevTools provide:"
  echo "   - Browser automation (navigate, click, fill out forms)"
  echo "   - Generate E2E tests automatically"
  echo "   - Chrome DevTools debugging (Console, Network, Performance)"
  echo "   - Accessibility analysis"
  echo ""
  echo "   Do you want to add Browser Testing MCP now? [y/N]"
  if [ -t 0 ]; then
    read -r INSTALL_BROWSER_MCP
  else
    INSTALL_BROWSER_MCP="N"   # non-interactive (install-all/CI): skip
  fi

  if [[ "$INSTALL_BROWSER_MCP" =~ ^[Yy]$ ]]; then
    echo ""
    echo "   🔧 Adding Browser Testing MCP..."

    # Create config.toml if it does not exist
    mkdir -p "$HOME/.codex"

    cat "$SCRIPT_DIR/mcp/browser-testing.toml" >> "$CODEX_CONFIG_FILE"
    echo "   ✅ Added Playwright and Chrome DevTools to $CODEX_CONFIG_FILE"

    BROWSER_MCP_INSTALLED=true
    echo ""
    echo "   📚 More info: $WORKSPACE_ROOT/core/implementations/codex/mcp/BROWSER_TESTING_MCP_SETUP.md"
  else
    echo "   ⏭️  Skipped Browser Testing MCP configuration"
    echo "   💡 You can add it later in $CODEX_CONFIG_FILE"
    echo ""
    echo "   📚 See: $WORKSPACE_ROOT/core/implementations/codex/mcp/BROWSER_TESTING_MCP_SETUP.md"
  fi
fi

# 8. Check if Context7 MCP is configured
echo "8️⃣  Checking Context7 MCP (Up-to-date documentation)..."

CONTEXT7_INSTALLED=false

if [ -f "$CODEX_CONFIG_FILE" ]; then
  if grep -qF '[mcp_servers.context7]' "$CODEX_CONFIG_FILE"; then
    echo "   ✅ Context7 MCP is already configured"
    CONTEXT7_INSTALLED=true
  fi
fi

if [ "$CONTEXT7_INSTALLED" = false ]; then
  echo "   ⚠️  Context7 MCP is NOT configured"
  echo ""
  echo "   Context7 provides:"
  echo "   - Up-to-date, version-specific documentation for libraries"
  echo "   - React, TypeScript, Spring Boot, etc."
  echo "   - Injects automatically into prompts with 'use context7'"
  echo ""
  echo "   Do you want to add Context7 MCP now? [y/N]"
  if [ -t 0 ]; then
    read -r INSTALL_CONTEXT7
  else
    INSTALL_CONTEXT7="N"   # non-interactive (install-all/CI): skip
  fi

  if [[ "$INSTALL_CONTEXT7" =~ ^[Yy]$ ]]; then
    echo ""
    echo "   🔧 Adding Context7 MCP..."

    # Create config.toml if it does not exist
    mkdir -p "$HOME/.codex"

    cat "$SCRIPT_DIR/mcp/context7.toml" >> "$CODEX_CONFIG_FILE"
    echo "   ✅ Added Context7 to $CODEX_CONFIG_FILE"

    CONTEXT7_INSTALLED=true
    echo ""
    echo "   📚 More info: $WORKSPACE_ROOT/core/implementations/codex/mcp/CONTEXT7_MCP_SETUP.md"
  else
    echo "   ⏭️  Skipped Context7 MCP configuration"
    echo "   💡 You can add it later in $CODEX_CONFIG_FILE"
    echo ""
    echo "   📚 See: $WORKSPACE_ROOT/core/implementations/codex/mcp/CONTEXT7_MCP_SETUP.md"
  fi
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Installed:"
echo "   ~/.codex/AGENTS.md"
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
