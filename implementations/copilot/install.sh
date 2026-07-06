#!/usr/bin/env bash

# install.sh - Installerer GitHub Copilot-konfigurasjon globalt
#
# Globalt (~/.copilot/): copilot-instructions.md
# Globalt (~/.local/bin/): scripts

set -e  # Exit ved feil

echo "🔧 GitHub Copilot Setup"
echo "======================="
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

# 2. Installer AGENTS.md som global Copilot-instruksjon
echo "2️⃣  Installerer global Copilot-instruksjon..."

if [ ! -f "$WORKSPACE_ROOT/core/AGENTS.md" ]; then
  echo "   ❌ core/AGENTS.md ikke funnet!"
  echo "   Kjør core/scripts/build-agents-md.sh først, eller sjekk at du har siste versjon: git pull"
  exit 1
fi

mkdir -p "$HOME/.copilot"
cp "$WORKSPACE_ROOT/core/AGENTS.md" "$HOME/.copilot/copilot-instructions.md"
echo "   ✅ Installert: ~/.copilot/copilot-instructions.md"
echo ""

# Verifiser at ~/.local/bin er i PATH
echo "3️⃣  Verifiserer PATH..."
if [[ ":$PATH:" == *":$HOME/.local/bin:"* ]]; then
  echo "   ✅ ~/.local/bin er i PATH"
else
  echo "   ⚠️  ~/.local/bin er IKKE i PATH"
  echo "   ℹ️  Legg til følgende i ~/.zshrc eller ~/.bashrc:"
  echo ""
  echo "      export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
fi

# 4. Sjekk om GitHub Copilot extension er installert
echo "4️⃣  Sjekker GitHub Copilot extension..."

if command -v code &> /dev/null; then
  if code --list-extensions | grep -q "github.copilot"; then
    echo "   ✅ GitHub Copilot extension er installert"
  else
    echo "   ⚠️  GitHub Copilot extension er IKKE installert"
    echo ""
    echo "   Installer extensions:"
    echo "      code --install-extension GitHub.copilot"
    echo "      code --install-extension GitHub.copilot-chat"
    echo ""
  fi
else
  echo "   ⚠️  'code' kommando ikke funnet (VS Code CLI)"
  echo "   💡 Installer fra VS Code: Cmd+Shift+P → 'Shell Command: Install 'code' command in PATH'"
  echo ""
fi

# 5. Installer JetBrains Live Templates (valgfritt)
echo "5️⃣  JetBrains Live Templates..."

JETBRAINS_TEMPLATES="$WORKSPACE_ROOT/implementations/copilot/jetbrains/aide-templates.xml"

if [ -f "$JETBRAINS_TEMPLATES" ]; then
  echo "   📦 Live Templates tilgjengelig for JetBrains IDE-er"
  echo ""

  # Finn installerte JetBrains IDE-er
  JETBRAINS_DIR="$HOME/Library/Application Support/JetBrains"

  if [ -d "$JETBRAINS_DIR" ]; then
    FOUND_IDE=false
    for ide_dir in "$JETBRAINS_DIR"/*/; do
      if [ -d "$ide_dir" ]; then
        ide_name=$(basename "$ide_dir")
        templates_dir="$ide_dir/templates"

        # Hopp over backup-mapper og andre ikke-IDE-mapper
        if [[ "$ide_name" == *"backup"* ]] || [[ "$ide_name" == "consentOptions" ]]; then
          continue
        fi

        mkdir -p "$templates_dir"
        cp "$JETBRAINS_TEMPLATES" "$templates_dir/aide-templates.xml"
        echo "   ✅ Installert: $ide_name/templates/aide-templates.xml"
        FOUND_IDE=true
      fi
    done

    if [ "$FOUND_IDE" = false ]; then
      echo "   ⚠️  Ingen JetBrains IDE-er funnet"
      echo "   💡 Manuell installasjon:"
      echo "      cp $JETBRAINS_TEMPLATES ~/Library/Application Support/JetBrains/<IDE>/templates/"
    fi
  else
    echo "   ⚠️  JetBrains-mappe ikke funnet"
    echo "   💡 Hvis du bruker JetBrains IDE, kopier manuelt:"
    echo "      cp $JETBRAINS_TEMPLATES ~/Library/Application Support/JetBrains/<IDE>/templates/"
  fi

  echo ""
  echo "   📋 Tilgjengelige Live Templates:"
  echo "      aide-review    → Code review før PR"
  echo "      aide-opprett   → Opprett JIRA-dokumentasjon"
  echo "      aide-analyser  → Analyser kodebase"
  echo "      aide-løs       → Implementer med TDD"
  echo "      aide-lag-tester → Lag manglende tester"
  echo "      aide-react-class-to-func → Konverter React class"
  echo ""
  echo "   💡 Bruk: Skriv forkortelsen i editoren og trykk Tab"
fi

echo ""
echo "✅ Setup fullført!"
echo ""
echo "📋 Installert globalt:"
echo "   ~/.copilot/copilot-instructions.md  (regler for Copilot)"
echo "   ~/.local/bin/                       (scripts)"
echo ""
echo "💡 Tips:"
echo "   - Oppdater: Kjør ./install.sh på nytt"
echo "   - Oppdater regler: Rediger core/rules/, kjør core/scripts/build-agents-md.sh, deretter ./install.sh"
echo "   - Restart VS Code etter oppdatering"
echo ""
