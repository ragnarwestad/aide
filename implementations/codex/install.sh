#!/usr/bin/env bash

# install.sh - Installerer OpenAI Codex-konfigurasjon for doc-aide workspace
# Dette setter opp custom instructions, CLI-wrappers og JIRA-scripts

set -e  # Exit ved feil

echo "🔧 OpenAI Codex Setup"
echo "====================="
echo ""

# Codex installeres globalt (~/.codex/AGENTS.md + ~/.local/bin/) — ingen prosjekt-sti nødvendig

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

# 2. Installer Codex CLI-wrappers
echo "2️⃣  Installerer Codex CLI-wrappers til ~/.local/bin/..."

for script in codex-aide-create codex-aide-analyze codex-aide-implement; do
  if [ -f "$SCRIPT_DIR/scripts/$script" ]; then
    cp "$SCRIPT_DIR/scripts/$script" ~/.local/bin/
    chmod +x ~/.local/bin/$script
    echo "   ✅ Installert: ~/.local/bin/$script"
  fi
done

echo ""

# 3. Installer global Codex-instruksjon (AGENTS.md)
echo "3️⃣  Installerer global Codex-instruksjon..."

if [ ! -f "$WORKSPACE_ROOT/core/AGENTS.md" ]; then
  echo "   ❌ core/AGENTS.md ikke funnet!"
  echo "   Kjør core/scripts/build-agents-md.sh først, eller sjekk at du har siste versjon: git pull"
  exit 1
fi

mkdir -p "$HOME/.codex"
cp "$WORKSPACE_ROOT/core/AGENTS.md" "$HOME/.codex/AGENTS.md"
echo "   ✅ Installert: ~/.codex/AGENTS.md"

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

# 5. Sjekk om Codex CLI er installert
echo "5️⃣  Sjekker Codex CLI..."

if command -v codex &> /dev/null; then
  echo "   ✅ Codex CLI er installert: $(codex --version 2>/dev/null || echo 'versjon ukjent')"
else
  echo "   ⚠️  Codex CLI er IKKE installert"
  echo ""
  echo "   Installer via npm:"
  echo "      npm install -g @openai/codex"
  echo ""
  echo "   Eller via mise:"
  echo "      mise use -g npm:@openai/codex@latest"
  echo ""
fi

# 6. Sjekk om Browser Testing MCP er konfigurert
echo "6️⃣  Sjekker Browser Testing MCP (Playwright & Chrome DevTools)..."

CODEX_CONFIG_FILE="$HOME/.codex/config.toml"
BROWSER_MCP_INSTALLED=false

if [ -f "$CODEX_CONFIG_FILE" ]; then
  if grep -q 'name = "playwright"' "$CODEX_CONFIG_FILE" && grep -q 'name = "chrome-devtools"' "$CODEX_CONFIG_FILE"; then
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

    # Opprett config.toml hvis den ikke finnes
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
      echo "   ✅ Opprettet $CODEX_CONFIG_FILE med MCP servers"
    else
      # Append til eksisterende config
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
      echo "   ✅ La til Playwright og Chrome DevTools i $CODEX_CONFIG_FILE"
    fi

    BROWSER_MCP_INSTALLED=true
    echo ""
    echo "   📚 Mer info: $WORKSPACE_ROOT/implementations/codex/mcp/BROWSER_TESTING_MCP_SETUP.md"
  else
    echo "   ⏭️  Hoppet over Browser Testing MCP-konfigurasjon"
    echo "   💡 Du kan legge til senere i $CODEX_CONFIG_FILE"
    echo ""
    echo "   📚 Se: $WORKSPACE_ROOT/implementations/codex/mcp/BROWSER_TESTING_MCP_SETUP.md"
  fi
fi

# 7. Sjekk om Context7 MCP er konfigurert
echo "7️⃣  Sjekker Context7 MCP (Oppdatert dokumentasjon)..."

CONTEXT7_INSTALLED=false

if [ -f "$CODEX_CONFIG_FILE" ]; then
  if grep -q 'name = "context7"' "$CODEX_CONFIG_FILE"; then
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

    # Opprett config.toml hvis den ikke finnes
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
      echo "   ✅ Opprettet $CODEX_CONFIG_FILE med Context7"
    else
      # Append til eksisterende config
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
      echo "   ✅ La til Context7 i $CODEX_CONFIG_FILE"
    fi

    CONTEXT7_INSTALLED=true
    echo ""
    echo "   📚 Mer info: $WORKSPACE_ROOT/implementations/codex/mcp/CONTEXT7_MCP_SETUP.md"
  else
    echo "   ⏭️  Hoppet over Context7 MCP-konfigurasjon"
    echo "   💡 Du kan legge til senere i $CODEX_CONFIG_FILE"
    echo ""
    echo "   📚 Se: $WORKSPACE_ROOT/implementations/codex/mcp/CONTEXT7_MCP_SETUP.md"
  fi
fi

echo ""
echo "✅ Setup fullført!"
echo ""
echo "📋 Installert:"
echo "   ~/.local/bin/codex-aide-create"
echo "   ~/.local/bin/codex-aide-analyze"
echo "   ~/.local/bin/codex-aide-implement"
echo ""
echo "📝 Neste steg:"
echo "   1. Start Codex i et prosjekt:"
echo "      cd $AIDE_PROJECTS_PATH/my-app"
echo "      codex"
echo ""
echo "   3. Bruk CLI-wrappers:"
echo "      codex-aide-create PROJ-7890"
echo "      codex-aide-analyze PROJ-7890"
echo "      codex-aide-implement PROJ-7890"
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
  echo "   📖 Les: $WORKSPACE_ROOT/implementations/codex/mcp/BROWSER_TESTING_MCP_SETUP.md"
  echo ""
fi
if [ "$CONTEXT7_INSTALLED" = true ]; then
  echo "📚 Context7 MCP:"
  echo "   ✅ Context7 MCP konfigurert"
  echo "   💡 Oppdatert dokumentasjon for biblioteker tilgjengelig"
  echo "   💡 Bruk 'use context7' i prompts for oppdatert docs"
  echo "   📖 Les: $WORKSPACE_ROOT/implementations/codex/mcp/CONTEXT7_MCP_SETUP.md"
  echo ""
fi
echo "📚 Dokumentasjon:"
echo "   - $SCRIPT_DIR/README.md"
if [ "$BROWSER_MCP_INSTALLED" = true ]; then
  echo "   - $WORKSPACE_ROOT/implementations/codex/mcp/BROWSER_TESTING_MCP_SETUP.md"
fi
if [ "$CONTEXT7_INSTALLED" = true ]; then
  echo "   - $WORKSPACE_ROOT/implementations/codex/mcp/CONTEXT7_MCP_SETUP.md"
fi
echo ""
