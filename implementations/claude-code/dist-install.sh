#!/usr/bin/env bash

# install.sh - Installerer doc-aide-claude-code

set -e

echo "🔧 doc-aide-claude-code Install"
echo "===================================="
echo ""

# Finn hvor dette scriptet kjører fra (dist-pakke-roten)
DIST_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Sjekk at AIDE_PROJECTS_PATH er satt
if [ -z "$AIDE_PROJECTS_PATH" ]; then
  echo "❌ Feil: AIDE_PROJECTS_PATH er ikke satt"
  echo ""
  echo "Sett disse i ~/.zshrc eller ~/.bashrc:"
  echo "  export AIDE_PROJECTS_PATH=\"\$HOME/develop\""
  echo "  export AIDE_INSTALLATION_PATH=\"$DIST_DIR\""
  echo ""
  echo "(AIDE_INSTALLATION_PATH skal peke hit: $DIST_DIR)"
  echo ""
  echo "Deretter:"
  echo "  source ~/.zshrc"
  echo "  ./install.sh"
  exit 1
fi

echo "✅ AIDE_PROJECTS_PATH: $AIDE_PROJECTS_PATH"

# Verifiser at mappen eksisterer
if [ ! -d "$AIDE_PROJECTS_PATH" ]; then
  echo "❌ Mappen eksisterer ikke: $AIDE_PROJECTS_PATH"
  exit 1
fi

# Sjekk at AIDE_INSTALLATION_PATH er satt
if [ -z "$AIDE_INSTALLATION_PATH" ]; then
  echo "❌ Feil: AIDE_INSTALLATION_PATH er ikke satt"
  echo ""
  echo "Sett denne i ~/.zshrc eller ~/.bashrc:"
  echo "  export AIDE_INSTALLATION_PATH=\"$DIST_DIR\""
  echo ""
  echo "Deretter:"
  echo "  source ~/.zshrc"
  echo "  ./install.sh"
  exit 1
fi

echo "✅ AIDE_INSTALLATION_PATH: $AIDE_INSTALLATION_PATH"

# Verifiser at installasjons-mappen eksisterer og har templates
if [ ! -d "$AIDE_INSTALLATION_PATH/core/templates" ]; then
  echo "❌ Feil: Templates ikke funnet i: $AIDE_INSTALLATION_PATH/core/templates"
  echo ""
  echo "Er AIDE_INSTALLATION_PATH satt riktig?"
  exit 1
fi

echo "📂 Installerer fra: $DIST_DIR"
echo ""

# 1. Installer scripts til ~/.local/bin/
echo "1️⃣  Installerer scripts til ~/.local/bin/..."
mkdir -p ~/.local/bin

for script in aide-generate-pdf aide-generate-html aide-opprett; do
  if [ -f "$DIST_DIR/bin/$script" ]; then
    cp "$DIST_DIR/bin/$script" ~/.local/bin/
    chmod +x ~/.local/bin/$script
    echo "   ✅ $script"
  fi
done

echo ""

# 2. Kopier konfigurasjon til prosjekter
echo "2️⃣  Kopierer konfigurasjon til prosjekter..."

# Generer settings.json med absolutte stier
generate_settings() {
  local REPORTS_PERMISSION=""
  if [ -n "$AIDE_REPORTS_PATH" ]; then
    REPORTS_PERMISSION="      \"Read($AIDE_REPORTS_PATH/**)\",
      \"Write($AIDE_REPORTS_PATH/**)\",
      \"Edit($AIDE_REPORTS_PATH/**)\","
  fi

  cat <<EOF
{
  "permissions": {
    "defaultMode": "default",
    "allow": [
      "mcp__ide__getDiagnostics",
      "WebFetch(domain:raw.githubusercontent.com)",
      "Read($AIDE_PROJECTS_PATH/**)",
      "Write($AIDE_PROJECTS_PATH/**)",
      "Edit($AIDE_PROJECTS_PATH/**)"${REPORTS_PERMISSION:+,
$REPORTS_PERMISSION}
    ],
    "deny": [
      "Bash(git commit:*)",
      "Bash(git push:*)"
    ]
  }
}
EOF
}

for project in my-app my-api doc-aide my-docs; do
  PROJECT_DIR="$AIDE_PROJECTS_PATH/$project"

  if [ ! -d "$PROJECT_DIR" ]; then
    echo "   ⏭️  $project: finnes ikke"
    continue
  fi

  # Fjern gamle symlinks
  [ -L "$PROJECT_DIR/.claude" ] && rm "$PROJECT_DIR/.claude"
  [ -L "$PROJECT_DIR/CLAUDE.md" ] && rm "$PROJECT_DIR/CLAUDE.md"

  # Fjern gammel .claude mappe
  [ -d "$PROJECT_DIR/.claude" ] && rm -rf "$PROJECT_DIR/.claude"

  # Opprett .claude/
  mkdir -p "$PROJECT_DIR/.claude"

  # Kopier commands
  if [ -d "$DIST_DIR/.claude/commands" ]; then
    cp -r "$DIST_DIR/.claude/commands" "$PROJECT_DIR/.claude/"
  fi

  # Kopier skills (native Claude Code skills)
  if [ -d "$DIST_DIR/.claude/skills" ]; then
    cp -r "$DIST_DIR/.claude/skills" "$PROJECT_DIR/.claude/"
  fi

  # Kopier agents
  if [ -d "$DIST_DIR/agents" ]; then
    cp -r "$DIST_DIR/agents" "$PROJECT_DIR/.claude/"
  fi

  # Generer settings.json
  generate_settings > "$PROJECT_DIR/.claude/settings.json"

  # Kopier CLAUDE.md til .claude/ (ikke rot)
  cp "$DIST_DIR/CLAUDE.md" "$PROJECT_DIR/.claude/CLAUDE.md"

  # Fjern gammel rot-CLAUDE.md hvis den finnes
  if [ -f "$PROJECT_DIR/CLAUDE.md" ] && [ ! -L "$PROJECT_DIR/CLAUDE.md" ]; then
    rm "$PROJECT_DIR/CLAUDE.md"
  fi

  echo "   ✅ $project"
done

echo ""

# 3. Verifiser PATH
echo "3️⃣  Verifiserer PATH..."
if [[ ":$PATH:" == *":$HOME/.local/bin:"* ]]; then
  echo "   ✅ ~/.local/bin er i PATH"
else
  echo "   ⚠️  ~/.local/bin er IKKE i PATH"
  echo "   Legg til i ~/.zshrc:"
  echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

echo ""
echo "✅ Installasjon fullført!"
echo ""
echo "📝 Neste steg:"
echo "   1. Start Claude Code:"
echo "      cd $AIDE_PROJECTS_PATH/my-app && claude"
echo ""
echo "   2. Test:"
echo "      /aide-opprett PROJ-7637"
echo ""
