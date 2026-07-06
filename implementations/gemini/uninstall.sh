#!/usr/bin/env bash

# uninstall.sh - Fjerner Google Gemini CLI-konfigurasjon installert av install.sh
# Dette reverserer alle endringer gjort av install.sh

set -e  # Exit ved feil

echo "🗑️  Google Gemini CLI Uninstall"
echo "==============================="
echo ""

# Gemini er global — ingen prosjekt-sti nødvendig

# Bekreft avinstallasjon
echo "⚠️  Dette vil fjerne:"
echo "   - Scripts fra ~/.local/bin/ (aide-generate-*, mise-upgrade-ai-tools)"
echo "   - ~/.gemini/GEMINI.md"
echo "   - ~/.gemini/commands/aide-*.toml"
echo ""
read -p "Er du sikker på at du vil fortsette? [y/N]: " CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo ""
  echo "❌ Avbrutt"
  exit 0
fi

echo ""

# 1. Fjern scripts fra ~/.local/bin/
echo "1️⃣  Fjerner scripts fra ~/.local/bin/..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
source "$WORKSPACE_ROOT/core/scripts/_install-bin.sh"
uninstall_common_bin

echo ""

# 2. Fjern global Gemini-konfigurasjon
echo "2️⃣  Fjerner global Gemini-konfigurasjon..."

if [ -f "$HOME/.gemini/GEMINI.md" ]; then
  rm "$HOME/.gemini/GEMINI.md"
  echo "   ✅ Fjernet: ~/.gemini/GEMINI.md"
else
  echo "   ⏭️  Fantes ikke: ~/.gemini/GEMINI.md"
fi

if [ -d "$HOME/.gemini/commands" ]; then
  rm -f "$HOME/.gemini/commands/"aide-*.toml
  echo "   ✅ Fjernet: ~/.gemini/commands/aide-*.toml"
fi

echo ""

# 3. Informasjon om manuelle steg
echo "3️⃣  Manuell opprydding (valgfritt)..."
echo ""
echo "   Følgende må fjernes manuelt hvis ønskelig:"
echo ""
echo "   Gemini CLI:"
echo "      npm uninstall -g @google/gemini-cli"
echo "      # eller"
echo "      mise uninstall npm:@google/gemini-cli"
echo ""
echo "   Gemini config:"
echo "      rm -rf ~/.gemini"
echo ""
echo "   Environment variabler (i ~/.zshrc eller ~/.bashrc):"
echo "      export AIDE_PROJECTS_PATH=..."
echo "      export AIDE_INSTALLATION_PATH=..."
echo ""
echo "   JIRA-token:"
echo "      rm ~/.jira_token"
echo ""

echo "✅ Avinstallasjon fullført!"
echo ""
echo "💡 For å installere på nytt, kjør:"
echo "   cd implementations/gemini"
echo "   ./install.sh"
