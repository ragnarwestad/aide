#!/usr/bin/env bash

# install.sh - Installerer Google Gemini CLI-konfigurasjon for doc-aide workspace
# Dette setter opp custom instructions, slash commands og JIRA-scripts

set -e  # Exit ved feil

echo "🔧 Google Gemini CLI Setup"
echo "=========================="
echo ""

# Gemini installeres globalt (~/.gemini/GEMINI.md + commands) — ingen prosjekt-sti nødvendig

echo ""

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WORKSPACE_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Verifiser at workspace eksisterer
if [ ! -d "$WORKSPACE_ROOT" ]; then
  echo "❌ Kunne ikke finne workspace: $WORKSPACE_ROOT"
  exit 1
fi

echo "📂 Workspace: $WORKSPACE_ROOT"
echo ""

# 1. Installer scripts til ~/.local/bin/
echo "1️⃣  Installerer scripts til ~/.local/bin/..."
source "$WORKSPACE_ROOT/core/scripts/_install-bin.sh"
install_common_bin

echo ""

# 2. Installer global Gemini-instruksjon (GEMINI.md fra core/AGENTS.md)
echo "2️⃣  Installerer global Gemini-instruksjon..."

if [ ! -f "$WORKSPACE_ROOT/core/AGENTS.md" ]; then
  echo "   ❌ core/AGENTS.md ikke funnet!"
  echo "   Kjør core/scripts/build-agents-md.sh først, eller sjekk at du har siste versjon: git pull"
  exit 1
fi

mkdir -p "$HOME/.gemini"
cp "$WORKSPACE_ROOT/core/AGENTS.md" "$HOME/.gemini/GEMINI.md"
echo "   ✅ Installert: ~/.gemini/GEMINI.md (fra core/AGENTS.md)"
echo ""

# 3. Installer slash commands globalt
echo "3️⃣  Installerer Gemini slash commands..."

if [ -d "$SCRIPT_DIR/.gemini/commands" ]; then
  mkdir -p "$HOME/.gemini/commands"
  cp "$SCRIPT_DIR/.gemini/commands/"*.toml "$HOME/.gemini/commands/" 2>/dev/null || true
  echo "   ✅ Installert: ~/.gemini/commands/*.toml"
else
  echo "   ⏭️  Ingen commands å installere"
fi

echo ""

# 4. Verifiser at ~/.local/bin er i PATH
echo "4️⃣  Verifiserer PATH..."
if [[ ":$PATH:" == *":$HOME/.local/bin:"* ]]; then
  echo "   ✅ ~/.local/bin er i PATH"
else
  echo "   ⚠️  ~/.local/bin er IKKE i PATH"
  echo "   ℹ️  Legg til følgende i ~/.zshrc eller ~/.bashrc:"
  echo ""
  echo "      export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
fi

# 5. Sjekk om Gemini CLI er installert
echo "5️⃣  Sjekker Gemini CLI..."

if command -v gemini &> /dev/null; then
  echo "   ✅ Gemini CLI er installert: $(gemini --version 2>/dev/null || echo 'versjon ukjent')"
else
  echo "   ⚠️  Gemini CLI er IKKE installert"
  echo ""
  echo "   Installer via npm:"
  echo "      npm install -g @google/gemini-cli"
  echo ""
  echo "   Eller via mise:"
  echo "      mise use -g npm:@google/gemini-cli@latest"
  echo ""
fi

# 6. Sjekk om Browser Testing MCP er konfigurert
echo "6️⃣  Sjekker Browser Testing MCP (Playwright & Chrome DevTools)..."

GEMINI_CONFIG_FILE="$HOME/.gemini/settings.json"
BROWSER_MCP_INSTALLED=false

if [ -f "$GEMINI_CONFIG_FILE" ]; then
  if grep -q '"playwright"' "$GEMINI_CONFIG_FILE" && grep -q '"chrome-devtools"' "$GEMINI_CONFIG_FILE"; then
    echo "   ✅ Playwright og Chrome DevTools MCP er allerede konfigurert"
    BROWSER_MCP_INSTALLED=true
  fi
fi

if [ "$BROWSER_MCP_INSTALLED" = false ]; then
  echo "   ⚠️  Browser Testing MCP er IKKE konfigurert"
  echo ""
  echo "   Playwright & Chrome DevTools gir:"
  echo "   - Browser automatisering (navigere, klikke, fylle ut forms)"
  echo "   - Generere E2E tester automatisk"
  echo "   - Chrome DevTools debugging (Console, Network, Performance)"
  echo "   - Accessibility analyse"
  echo ""
  echo "   Vil du legge til Browser Testing MCP nå? [y/N]"
  if [ -t 0 ]; then
    read -r INSTALL_BROWSER_MCP
  else
    INSTALL_BROWSER_MCP="N"   # non-interaktivt (install-all/CI): hopp over
  fi

  if [[ "$INSTALL_BROWSER_MCP" =~ ^[Yy]$ ]]; then
    echo ""
    echo "   🔧 Legger til Browser Testing MCP..."

    # Opprett settings.json hvis den ikke finnes
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

      echo "   ✅ Playwright MCP konfigurert"
      echo "   ✅ Chrome DevTools MCP konfigurert"
      BROWSER_MCP_INSTALLED=true
    else
      echo "   ❌ jq ikke funnet. Legg til manuelt:"
      echo ""
      echo "   Rediger $GEMINI_CONFIG_FILE og legg til:"
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
    echo "   📚 Mer info: $WORKSPACE_ROOT/implementations/gemini/mcp/BROWSER_TESTING_MCP_SETUP.md"
  else
    echo "   ⏭️  Hoppet over Browser Testing MCP-konfigurasjon"
    echo "   💡 Du kan legge til senere i $GEMINI_CONFIG_FILE"
    echo ""
    echo "   📚 Se: $WORKSPACE_ROOT/implementations/gemini/mcp/BROWSER_TESTING_MCP_SETUP.md"
  fi
fi

# 7. Sjekk om Context7 MCP er konfigurert
echo "7️⃣  Sjekker Context7 MCP (Oppdatert dokumentasjon)..."

CONTEXT7_INSTALLED=false

if [ -f "$GEMINI_CONFIG_FILE" ]; then
  if grep -q '"context7"' "$GEMINI_CONFIG_FILE"; then
    echo "   ✅ Context7 MCP er allerede konfigurert"
    CONTEXT7_INSTALLED=true
  fi
fi

if [ "$CONTEXT7_INSTALLED" = false ]; then
  echo "   ⚠️  Context7 MCP er IKKE konfigurert"
  echo ""
  echo "   Context7 gir:"
  echo "   - Oppdatert, versjonsspesifikk dokumentasjon for biblioteker"
  echo "   - React, TypeScript, Spring Boot, etc."
  echo "   - Injiserer automatisk i prompts med 'use context7'"
  echo ""
  echo "   Vil du legge til Context7 MCP nå? [y/N]"
  if [ -t 0 ]; then
    read -r INSTALL_CONTEXT7
  else
    INSTALL_CONTEXT7="N"   # non-interaktivt (install-all/CI): hopp over
  fi

  if [[ "$INSTALL_CONTEXT7" =~ ^[Yy]$ ]]; then
    echo ""
    echo "   🔧 Legger til Context7 MCP..."

    # Opprett settings.json hvis den ikke finnes
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

      echo "   ✅ Context7 MCP konfigurert"
      CONTEXT7_INSTALLED=true
    else
      echo "   ❌ jq ikke funnet. Legg til manuelt:"
      echo ""
      echo "   Rediger $GEMINI_CONFIG_FILE og legg til:"
      echo '   "mcpServers": {'
      echo '     "context7": {'
      echo '       "command": "npx",'
      echo '       "args": ["-y", "@upstash/context7-mcp"]'
      echo '     }'
      echo '   }'
    fi

    echo ""
    echo "   📚 Mer info: $WORKSPACE_ROOT/implementations/gemini/mcp/CONTEXT7_MCP_SETUP.md"
  else
    echo "   ⏭️  Hoppet over Context7 MCP-konfigurasjon"
    echo "   💡 Du kan legge til senere i $GEMINI_CONFIG_FILE"
    echo ""
    echo "   📚 Se: $WORKSPACE_ROOT/implementations/gemini/mcp/CONTEXT7_MCP_SETUP.md"
  fi
fi

echo ""
echo "✅ Setup fullført!"
echo ""
echo "📋 Installert:"
echo "   $AIDE_PROJECTS_PATH/*/GEMINI.md"
echo "   $AIDE_PROJECTS_PATH/*/.gemini/commands/*.toml"
echo ""
echo "📝 Neste steg:"
echo "   1. Start Gemini CLI i et prosjekt:"
echo "      cd $AIDE_PROJECTS_PATH/my-app"
echo "      gemini"
echo ""
echo "   3. Bruk slash commands:"
echo "      /aide-opprett PROJ-7890"
echo "      /aide-analyser PROJ-7890"
echo "      /aide-los PROJ-7890"
echo ""
echo "💡 Tips:"
echo "   - Oppdater konfigurasjon: Kjør ./install.sh på nytt"
echo "   - Avinstaller: ./uninstall.sh"
echo ""
if [ "$BROWSER_MCP_INSTALLED" = true ]; then
  echo "🌐 Browser Testing MCP:"
  echo "   ✅ Playwright MCP konfigurert"
  echo "   ✅ Chrome DevTools MCP konfigurert"
  echo "   💡 Browser automatisering og debugging tilgjengelig"
  echo "   📖 Les: $WORKSPACE_ROOT/implementations/gemini/mcp/BROWSER_TESTING_MCP_SETUP.md"
  echo ""
fi
if [ "$CONTEXT7_INSTALLED" = true ]; then
  echo "📚 Context7 MCP:"
  echo "   ✅ Context7 MCP konfigurert"
  echo "   💡 Oppdatert dokumentasjon for biblioteker tilgjengelig"
  echo "   💡 Bruk 'use context7' i prompts for oppdatert docs"
  echo "   📖 Les: $WORKSPACE_ROOT/implementations/gemini/mcp/CONTEXT7_MCP_SETUP.md"
  echo ""
fi
echo "📚 Dokumentasjon:"
echo "   - $SCRIPT_DIR/README.md"
if [ "$BROWSER_MCP_INSTALLED" = true ]; then
  echo "   - $WORKSPACE_ROOT/implementations/gemini/mcp/BROWSER_TESTING_MCP_SETUP.md"
fi
if [ "$CONTEXT7_INSTALLED" = true ]; then
  echo "   - $WORKSPACE_ROOT/implementations/gemini/mcp/CONTEXT7_MCP_SETUP.md"
fi
echo ""
