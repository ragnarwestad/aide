#!/usr/bin/env bash

# uninstall.sh - Fjerner GitHub Copilot-konfigurasjon installert av install.sh
# Reverserer NØYAKTIG det install.sh gjør — ikke mer, ikke mindre.

set -e  # Exit ved feil

echo "🗑️  GitHub Copilot Uninstall"
echo "============================"
echo ""

# Bekreft avinstallasjon
echo "⚠️  Dette vil fjerne:"
echo "   - Scripts fra ~/.local/bin/ (aide-generate-pdf, aide-generate-html, mise-upgrade-ai-tools)"
echo "   - ~/.copilot/copilot-instructions.md"
echo "   - JetBrains Live Templates (aide-templates.xml)"
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

# 2. Fjern global Copilot-instruksjon
echo "2️⃣  Fjerner global Copilot-instruksjon..."

if [ -f "$HOME/.copilot/copilot-instructions.md" ]; then
  rm "$HOME/.copilot/copilot-instructions.md"
  echo "   ✅ Fjernet: ~/.copilot/copilot-instructions.md"
else
  echo "   ⏭️  Fantes ikke: ~/.copilot/copilot-instructions.md"
fi

echo ""

# 3. Fjern JetBrains Live Templates
echo "3️⃣  Fjerner JetBrains Live Templates..."

JETBRAINS_DIR="$HOME/Library/Application Support/JetBrains"

if [ -d "$JETBRAINS_DIR" ]; then
  for ide_dir in "$JETBRAINS_DIR"/*/; do
    if [ -d "$ide_dir" ]; then
      ide_name=$(basename "$ide_dir")
      templates_file="$ide_dir/templates/aide-templates.xml"

      # Hopp over backup-mapper
      if [[ "$ide_name" == *"backup"* ]] || [[ "$ide_name" == "consentOptions" ]]; then
        continue
      fi

      if [ -f "$templates_file" ]; then
        rm "$templates_file"
        echo "   ✅ Fjernet: $ide_name/templates/aide-templates.xml"
      fi
    fi
  done
else
  echo "   ⏭️  JetBrains-mappe ikke funnet"
fi

echo ""

echo "✅ Avinstallasjon fullført!"
echo ""
echo "💡 For å installere på nytt, kjør:"
echo "   cd implementations/copilot"
echo "   ./install.sh"
