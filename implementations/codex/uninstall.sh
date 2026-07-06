#!/usr/bin/env bash

# uninstall.sh - Fjerner OpenAI Codex-konfigurasjon installert av install.sh
# Dette reverserer alle endringer gjort av install.sh

set -e  # Exit ved feil

echo "🗑️  OpenAI Codex Uninstall"
echo "=========================="
echo ""

# Codex er global — ingen prosjekt-sti nødvendig

# Bekreft avinstallasjon
echo "⚠️  Dette vil fjerne:"
echo "   - Scripts fra ~/.local/bin/ (aide-generate-*, mise-upgrade-ai-tools, codex-aide-*)"
echo "   - ~/.codex/AGENTS.md"
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

# Codex-spesifikke CLI-wrappers (installeres av install.sh)
for script in codex-aide-opprett codex-aide-analyser codex-aide-los; do
  if [ -f "$HOME/.local/bin/$script" ]; then
    rm "$HOME/.local/bin/$script"
    echo "   ✅ Fjernet: ~/.local/bin/$script"
  fi
done

echo ""

# 2. Fjern global Codex-instruksjon
echo "2️⃣  Fjerner global Codex-instruksjon..."

if [ -f "$HOME/.codex/AGENTS.md" ]; then
  rm "$HOME/.codex/AGENTS.md"
  echo "   ✅ Fjernet: ~/.codex/AGENTS.md"
else
  echo "   ⏭️  Fantes ikke: ~/.codex/AGENTS.md"
fi

echo ""

# 3. Informasjon om manuelle steg
echo "3️⃣  Manuell opprydding (valgfritt)..."
echo ""
echo "   Følgende må fjernes manuelt hvis ønskelig:"
echo ""
echo "   Codex CLI:"
echo "      npm uninstall -g @openai/codex"
echo "      # eller"
echo "      mise uninstall npm:@openai/codex"
echo ""
echo "   Codex config:"
echo "      rm -rf ~/.codex"
echo ""
echo "   Environment variabler (i ~/.zshrc eller ~/.bashrc):"
echo "      export AIDE_PROJECTS_PATH=..."
echo "      export AIDE_INSTALLATION_PATH=..."
echo "      export OPENAI_API_KEY=..."
echo ""
echo "   JIRA-token:"
echo "      rm ~/.jira_token"
echo ""

echo "✅ Avinstallasjon fullført!"
echo ""
echo "💡 For å installere på nytt, kjør:"
echo "   cd implementations/codex"
echo "   ./install.sh"
