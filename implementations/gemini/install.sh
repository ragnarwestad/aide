#!/usr/bin/env bash

# install.sh - Installs Google Gemini CLI configuration for the doc-aide workspace
# This sets up custom instructions, slash commands and JIRA scripts

set -e  # Exit on error

echo "🔧 Google Gemini CLI Setup"
echo "=========================="
echo ""

# Gemini is installed globally (~/.gemini/GEMINI.md + commands) — no project path needed

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

# 2. Install global Gemini instructions (GEMINI.md from core/AGENTS.md)
echo "2️⃣  Installing global Gemini instructions..."

if [ ! -f "$WORKSPACE_ROOT/core/AGENTS.md" ]; then
  echo "   ❌ core/AGENTS.md not found!"
  echo "   Run core/scripts/build-agents-md.sh first, or make sure you have the latest version: git pull"
  exit 1
fi

mkdir -p "$HOME/.gemini"
cp "$WORKSPACE_ROOT/core/AGENTS.md" "$HOME/.gemini/GEMINI.md"
echo "   ✅ Installed: ~/.gemini/GEMINI.md (from core/AGENTS.md)"
echo ""

# 3. Install slash commands globally
echo "3️⃣  Installing Gemini slash commands..."

if [ -d "$SCRIPT_DIR/.gemini/commands" ]; then
  mkdir -p "$HOME/.gemini/commands"
  cp "$SCRIPT_DIR/.gemini/commands/"*.toml "$HOME/.gemini/commands/" 2>/dev/null || true
  echo "   ✅ Installed: ~/.gemini/commands/*.toml"
else
  echo "   ⏭️  No commands to install"
fi

echo ""

# 4. Verify that ~/.local/bin is in PATH
echo "4️⃣  Verifying PATH..."
if [[ ":$PATH:" == *":$HOME/.local/bin:"* ]]; then
  echo "   ✅ ~/.local/bin is in PATH"
else
  echo "   ⚠️  ~/.local/bin is NOT in PATH"
  echo "   ℹ️  Add the following to ~/.zshrc or ~/.bashrc:"
  echo ""
  echo "      export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
fi

# 5. Check whether the Gemini CLI is installed
echo "5️⃣  Checking Gemini CLI..."

if command -v gemini &> /dev/null; then
  echo "   ✅ Gemini CLI is installed: $(gemini --version 2>/dev/null || echo 'unknown version')"
else
  echo "   ⚠️  Gemini CLI is NOT installed"
  echo ""
  echo "   Install via npm:"
  echo "      npm install -g @google/gemini-cli"
  echo ""
  echo "   Or via mise:"
  echo "      mise use -g npm:@google/gemini-cli@latest"
  echo ""
fi

# 6. Check whether Browser Testing MCP is configured
echo "6️⃣  Checking Browser Testing MCP (Playwright & Chrome DevTools)..."

GEMINI_CONFIG_FILE="$HOME/.gemini/settings.json"
BROWSER_MCP_INSTALLED=false

if [ -f "$GEMINI_CONFIG_FILE" ]; then
  if grep -q '"playwright"' "$GEMINI_CONFIG_FILE" && grep -q '"chrome-devtools"' "$GEMINI_CONFIG_FILE"; then
    echo "   ✅ Playwright and Chrome DevTools MCP are already configured"
    BROWSER_MCP_INSTALLED=true
  fi
fi

if [ "$BROWSER_MCP_INSTALLED" = false ]; then
  echo "   ⚠️  Browser Testing MCP is NOT configured"
  echo ""
  echo "   Playwright & Chrome DevTools provide:"
  echo "   - Browser automation (navigate, click, fill out forms)"
  echo "   - Automatic E2E test generation"
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

    # Create settings.json if it does not exist
    mkdir -p "$HOME/.gemini"

    if command -v jq &> /dev/null; then
      if [ ! -f "$GEMINI_CONFIG_FILE" ]; then
        echo '{"mcpServers":{}}' > "$GEMINI_CONFIG_FILE"
      fi

      # Backup existing config
      cp "$GEMINI_CONFIG_FILE" "$GEMINI_CONFIG_FILE.backup"

      # Add Playwright
      jq '.mcpServers.playwright = {
        "command": "npx",
        "args": ["@playwright/mcp@latest"]
      }' "$GEMINI_CONFIG_FILE" > "$GEMINI_CONFIG_FILE.tmp" && mv "$GEMINI_CONFIG_FILE.tmp" "$GEMINI_CONFIG_FILE"

      # Add Chrome DevTools
      jq '.mcpServers["chrome-devtools"] = {
        "command": "npx",
        "args": ["chrome-devtools-mcp@latest"]
      }' "$GEMINI_CONFIG_FILE" > "$GEMINI_CONFIG_FILE.tmp" && mv "$GEMINI_CONFIG_FILE.tmp" "$GEMINI_CONFIG_FILE"

      echo "   ✅ Playwright MCP configured"
      echo "   ✅ Chrome DevTools MCP configured"
      BROWSER_MCP_INSTALLED=true
    else
      echo "   ❌ jq not found. Add manually:"
      echo ""
      echo "   Edit $GEMINI_CONFIG_FILE and add:"
      echo '   "mcpServers": {'
      echo '     "playwright": {'
      echo '       "command": "npx",'
      echo '       "args": ["@playwright/mcp@latest"]'
      echo '     },'
      echo '     "chrome-devtools": {'
      echo '       "command": "npx",'
      echo '       "args": ["chrome-devtools-mcp@latest"]'
      echo '     }'
      echo '   }'
    fi

    echo ""
    echo "   📚 More info: $WORKSPACE_ROOT/implementations/gemini/mcp/BROWSER_TESTING_MCP_SETUP.md"
  else
    echo "   ⏭️  Skipped Browser Testing MCP configuration"
    echo "   💡 You can add it later in $GEMINI_CONFIG_FILE"
    echo ""
    echo "   📚 See: $WORKSPACE_ROOT/implementations/gemini/mcp/BROWSER_TESTING_MCP_SETUP.md"
  fi
fi

# 7. Check whether Context7 MCP is configured
echo "7️⃣  Checking Context7 MCP (Up-to-date documentation)..."

CONTEXT7_INSTALLED=false

if [ -f "$GEMINI_CONFIG_FILE" ]; then
  if grep -q '"context7"' "$GEMINI_CONFIG_FILE"; then
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

    # Create settings.json if it does not exist
    mkdir -p "$HOME/.gemini"

    if command -v jq &> /dev/null; then
      if [ ! -f "$GEMINI_CONFIG_FILE" ]; then
        echo '{"mcpServers":{}}' > "$GEMINI_CONFIG_FILE"
      fi

      # Backup existing config
      cp "$GEMINI_CONFIG_FILE" "$GEMINI_CONFIG_FILE.backup"

      # Add Context7
      jq '.mcpServers.context7 = {
        "command": "npx",
        "args": ["-y", "@upstash/context7-mcp"]
      }' "$GEMINI_CONFIG_FILE" > "$GEMINI_CONFIG_FILE.tmp" && mv "$GEMINI_CONFIG_FILE.tmp" "$GEMINI_CONFIG_FILE"

      echo "   ✅ Context7 MCP configured"
      CONTEXT7_INSTALLED=true
    else
      echo "   ❌ jq not found. Add manually:"
      echo ""
      echo "   Edit $GEMINI_CONFIG_FILE and add:"
      echo '   "mcpServers": {'
      echo '     "context7": {'
      echo '       "command": "npx",'
      echo '       "args": ["-y", "@upstash/context7-mcp"]'
      echo '     }'
      echo '   }'
    fi

    echo ""
    echo "   📚 More info: $WORKSPACE_ROOT/implementations/gemini/mcp/CONTEXT7_MCP_SETUP.md"
  else
    echo "   ⏭️  Skipped Context7 MCP configuration"
    echo "   💡 You can add it later in $GEMINI_CONFIG_FILE"
    echo ""
    echo "   📚 See: $WORKSPACE_ROOT/implementations/gemini/mcp/CONTEXT7_MCP_SETUP.md"
  fi
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Installed:"
echo "   $AIDE_PROJECTS_PATH/*/GEMINI.md"
echo "   $AIDE_PROJECTS_PATH/*/.gemini/commands/*.toml"
echo ""
echo "📝 Next steps:"
echo "   1. Start the Gemini CLI in a project:"
echo "      cd $AIDE_PROJECTS_PATH/my-app"
echo "      gemini"
echo ""
echo "   3. Use slash commands:"
echo "      /aide-create PROJ-7890"
echo "      /aide-analyze PROJ-7890"
echo "      /aide-implement PROJ-7890"
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
  echo "   📖 Read: $WORKSPACE_ROOT/implementations/gemini/mcp/BROWSER_TESTING_MCP_SETUP.md"
  echo ""
fi
if [ "$CONTEXT7_INSTALLED" = true ]; then
  echo "📚 Context7 MCP:"
  echo "   ✅ Context7 MCP configured"
  echo "   💡 Up-to-date library documentation available"
  echo "   💡 Use 'use context7' in prompts for up-to-date docs"
  echo "   📖 Read: $WORKSPACE_ROOT/implementations/gemini/mcp/CONTEXT7_MCP_SETUP.md"
  echo ""
fi
echo "📚 Documentation:"
echo "   - $SCRIPT_DIR/README.md"
if [ "$BROWSER_MCP_INSTALLED" = true ]; then
  echo "   - $WORKSPACE_ROOT/implementations/gemini/mcp/BROWSER_TESTING_MCP_SETUP.md"
fi
if [ "$CONTEXT7_INSTALLED" = true ]; then
  echo "   - $WORKSPACE_ROOT/implementations/gemini/mcp/CONTEXT7_MCP_SETUP.md"
fi
echo ""
