#!/usr/bin/env bash

# install.sh - Installs OpenAI Codex configuration for the aide workspace
# This sets up custom instructions and shared CLI scripts

set -e  # Exit on error

echo "🔧 OpenAI Codex Setup"
echo "====================="
echo ""

# Codex is installed globally (~/.codex/AGENTS.md + ~/.local/bin/) — no project path needed

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

# 2. Install global Codex instructions (AGENTS.md)
echo "2️⃣  Installing global Codex instructions..."

if [ ! -f "$WORKSPACE_ROOT/core/AGENTS.md" ]; then
  echo "   ❌ core/AGENTS.md not found!"
  echo "   Run core/scripts/build-agents-md.sh first, or make sure you have the latest version: git pull"
  exit 1
fi

mkdir -p "$HOME/.codex"
cp "$WORKSPACE_ROOT/core/AGENTS.md" "$HOME/.codex/AGENTS.md"
echo "   ✅ Installed: ~/.codex/AGENTS.md"

echo ""

# 3. Verify that ~/.local/bin is in PATH
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

# 4. Check if Codex CLI is installed
echo "4️⃣  Checking Codex CLI..."

if command -v codex &> /dev/null; then
  echo "   ✅ Codex CLI is installed: $(codex --version 2>/dev/null || echo 'version unknown')"
else
  echo "   ⚠️  Codex CLI is NOT installed"
  echo ""
  echo "   Install via npm:"
  echo "      npm install -g @openai/codex"
  echo ""
  echo "   Or via mise:"
  echo "      mise use -g npm:@openai/codex@latest"
  echo ""
fi

# 5. Check if Browser Testing MCP is configured
echo "5️⃣  Checking Browser Testing MCP (Playwright & Chrome DevTools)..."

CODEX_CONFIG_FILE="$HOME/.codex/config.toml"
BROWSER_MCP_INSTALLED=false

if [ -f "$CODEX_CONFIG_FILE" ]; then
  if grep -q 'name = "playwright"' "$CODEX_CONFIG_FILE" && grep -q 'name = "chrome-devtools"' "$CODEX_CONFIG_FILE"; then
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

    if [ ! -f "$CODEX_CONFIG_FILE" ]; then
      cat > "$CODEX_CONFIG_FILE" <<'EOF'
[mcp]

# Playwright MCP Server
[[mcp.servers]]
name = "playwright"
command = "npx"
args = ["@playwright/mcp@latest"]

# Chrome DevTools MCP Server
[[mcp.servers]]
name = "chrome-devtools"
command = "npx"
args = ["chrome-devtools-mcp@latest"]
EOF
      echo "   ✅ Created $CODEX_CONFIG_FILE with MCP servers"
    else
      # Append to existing config
      if ! grep -q '\[mcp\]' "$CODEX_CONFIG_FILE"; then
        echo "" >> "$CODEX_CONFIG_FILE"
        echo "[mcp]" >> "$CODEX_CONFIG_FILE"
      fi

      cat >> "$CODEX_CONFIG_FILE" <<'EOF'

# Playwright MCP Server
[[mcp.servers]]
name = "playwright"
command = "npx"
args = ["@playwright/mcp@latest"]

# Chrome DevTools MCP Server
[[mcp.servers]]
name = "chrome-devtools"
command = "npx"
args = ["chrome-devtools-mcp@latest"]
EOF
      echo "   ✅ Added Playwright and Chrome DevTools to $CODEX_CONFIG_FILE"
    fi

    BROWSER_MCP_INSTALLED=true
    echo ""
    echo "   📚 More info: $WORKSPACE_ROOT/implementations/codex/mcp/BROWSER_TESTING_MCP_SETUP.md"
  else
    echo "   ⏭️  Skipped Browser Testing MCP configuration"
    echo "   💡 You can add it later in $CODEX_CONFIG_FILE"
    echo ""
    echo "   📚 See: $WORKSPACE_ROOT/implementations/codex/mcp/BROWSER_TESTING_MCP_SETUP.md"
  fi
fi

# 6. Check if Context7 MCP is configured
echo "6️⃣  Checking Context7 MCP (Up-to-date documentation)..."

CONTEXT7_INSTALLED=false

if [ -f "$CODEX_CONFIG_FILE" ]; then
  if grep -q 'name = "context7"' "$CODEX_CONFIG_FILE"; then
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

    if [ ! -f "$CODEX_CONFIG_FILE" ]; then
      cat > "$CODEX_CONFIG_FILE" <<'EOF'
[mcp]

# Context7 MCP Server
[[mcp.servers]]
name = "context7"
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
EOF
      echo "   ✅ Created $CODEX_CONFIG_FILE with Context7"
    else
      # Append to existing config
      if ! grep -q '\[mcp\]' "$CODEX_CONFIG_FILE"; then
        echo "" >> "$CODEX_CONFIG_FILE"
        echo "[mcp]" >> "$CODEX_CONFIG_FILE"
      fi

      cat >> "$CODEX_CONFIG_FILE" <<'EOF'

# Context7 MCP Server
[[mcp.servers]]
name = "context7"
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
EOF
      echo "   ✅ Added Context7 to $CODEX_CONFIG_FILE"
    fi

    CONTEXT7_INSTALLED=true
    echo ""
    echo "   📚 More info: $WORKSPACE_ROOT/implementations/codex/mcp/CONTEXT7_MCP_SETUP.md"
  else
    echo "   ⏭️  Skipped Context7 MCP configuration"
    echo "   💡 You can add it later in $CODEX_CONFIG_FILE"
    echo ""
    echo "   📚 See: $WORKSPACE_ROOT/implementations/codex/mcp/CONTEXT7_MCP_SETUP.md"
  fi
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Installed:"
echo "   ~/.codex/AGENTS.md"
echo ""
echo "📝 Next steps:"
echo "   1. Start Codex in a project:"
echo "      cd $AIDE_PROJECTS_PATH/my-app"
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
  echo "   📖 Read: $WORKSPACE_ROOT/implementations/codex/mcp/BROWSER_TESTING_MCP_SETUP.md"
  echo ""
fi
if [ "$CONTEXT7_INSTALLED" = true ]; then
  echo "📚 Context7 MCP:"
  echo "   ✅ Context7 MCP configured"
  echo "   💡 Up-to-date documentation for libraries available"
  echo "   💡 Use 'use context7' in prompts for up-to-date docs"
  echo "   📖 Read: $WORKSPACE_ROOT/implementations/codex/mcp/CONTEXT7_MCP_SETUP.md"
  echo ""
fi
echo "📚 Documentation:"
echo "   - $SCRIPT_DIR/README.md"
if [ "$BROWSER_MCP_INSTALLED" = true ]; then
  echo "   - $WORKSPACE_ROOT/implementations/codex/mcp/BROWSER_TESTING_MCP_SETUP.md"
fi
if [ "$CONTEXT7_INSTALLED" = true ]; then
  echo "   - $WORKSPACE_ROOT/implementations/codex/mcp/CONTEXT7_MCP_SETUP.md"
fi
echo ""
