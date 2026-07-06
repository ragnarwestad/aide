#!/usr/bin/env bash

# install.sh - Installerer Claude Code-konfigurasjon globalt
#
# Globalt (~/.claude/): skills, agents, regler
# Globalt (~/.local/bin/): scripts

set -e  # Exit ved feil

echo "🔧 Claude Code Setup"
echo "====================="
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

IMPL_DIR="$SCRIPT_DIR"

# 1. Installer scripts til ~/.local/bin/
echo "1️⃣  Installerer scripts til ~/.local/bin/..."
source "$WORKSPACE_ROOT/core/scripts/_install-bin.sh"
install_common_bin

echo ""

# 2. Installer globalt til ~/.claude/ (skills, agents, regler)
echo "2️⃣  Installerer globalt til ~/.claude/..."

GLOBAL_CLAUDE="$HOME/.claude"
mkdir -p "$GLOBAL_CLAUDE/skills" "$GLOBAL_CLAUDE/agents" "$GLOBAL_CLAUDE/rules"

# Skills (kopier uten --delete for å ikke slette andre verktøys skills)
if [ -d "$WORKSPACE_ROOT/core/skills" ]; then
  rsync -a "$WORKSPACE_ROOT/core/skills/" "$GLOBAL_CLAUDE/skills/"
  echo "   ✅ Skills installert: ~/.claude/skills/"
fi

# Migrer: fjern gamle commands (nå konsolidert i skills)
if [ -d "$GLOBAL_CLAUDE/commands" ]; then
  rm -rf "$GLOBAL_CLAUDE/commands"
  echo "   🗑️  Fjernet gammel: ~/.claude/commands/ (konsolidert i skills)"
fi

# Agents
if [ -d "$IMPL_DIR/agents" ]; then
  rsync -a "$IMPL_DIR/agents/" "$GLOBAL_CLAUDE/agents/"
  echo "   ✅ Agents installert: ~/.claude/agents/"
fi

# Generiske regler
GENERIC_RULES="tools-and-scripts workflows llm-discipline git testing documentation markdown-linting report-structure communication"
for rule in $GENERIC_RULES; do
  if [ -f "$WORKSPACE_ROOT/core/rules/$rule.md" ]; then
    cp "$WORKSPACE_ROOT/core/rules/$rule.md" "$GLOBAL_CLAUDE/rules/"
  fi
done
echo "   ✅ Regler installert: ~/.claude/rules/"

# Migrer: fjern gamle docs/ og api-mapping/ (nå konsolidert i skills)
for old_dir in docs api-mapping; do
  if [ -d "$GLOBAL_CLAUDE/$old_dir" ]; then
    rm -rf "$GLOBAL_CLAUDE/$old_dir"
    echo "   🗑️  Fjernet gammel: ~/.claude/$old_dir/ (konsolidert i skills)"
  fi
done

echo ""

# 3. Verifiser at ~/.local/bin er i PATH
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

# 4. Installer LSP-plugins (native Claude Code)
echo "4️⃣  Installerer LSP-plugins..."

if command -v claude &> /dev/null; then
  for plugin in typescript-lsp kotlin-lsp jdtls-lsp; do
    if claude plugin install "${plugin}@claude-plugins-official" 2>/dev/null; then
      echo "   ✅ $plugin installert"
    else
      echo "   ⏭️  $plugin: allerede installert eller ikke tilgjengelig"
    fi
  done
else
  echo "   ⚠️  Claude CLI ikke funnet - installer LSP-plugins manuelt:"
  echo "      claude plugin install typescript-lsp@claude-plugins-official"
  echo "      claude plugin install kotlin-lsp@claude-plugins-official"
  echo "      claude plugin install jdtls-lsp@claude-plugins-official"
fi

echo ""
echo "✅ Setup fullført!"
echo ""
echo "📋 Installert globalt:"
echo "   ~/.claude/skills/          ($(ls ~/.claude/skills/ 2>/dev/null | wc -l | tr -d ' ') skills)"
echo "   ~/.claude/rules/           ($(ls ~/.claude/rules/ 2>/dev/null | wc -l | tr -d ' ') regler)"
echo "   ~/.claude/agents/          (agents)"
echo "   ~/.local/bin/              (scripts)"
echo ""
echo "🔌 LSP-plugins:"
echo "   - typescript-lsp, kotlin-lsp, jdtls-lsp"
echo ""
echo "💡 Tips:"
echo "   - Oppdater: Kjør ./install.sh på nytt"
echo "   - Restart Claude Code etter oppdatering"
echo ""
