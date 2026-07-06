#!/usr/bin/env bash

# uninstall.sh - Fjerner Claude Code-konfigurasjon installert av install.sh
# Reverserer NØYAKTIG det install.sh gjør — ikke mer, ikke mindre.

set -e  # Exit ved feil

echo "🗑️  Claude Code Uninstall"
echo "========================="
echo ""

# Bekreft avinstallasjon
echo "⚠️  Dette vil fjerne:"
echo "   - Scripts fra ~/.local/bin/ (aide-generate-pdf, aide-generate-html, mise-upgrade-ai-tools)"
echo "   - Skills fra ~/.claude/skills/ (9 navngitte mapper)"
echo "   - Agents fra ~/.claude/agents/ (task-analyzer.md)"
echo "   - Rules fra ~/.claude/rules/ (9 navngitte filer)"
echo "   - ~/.claude/docs/ og ~/.claude/api-mapping/ (legacy)"
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

# 2. Fjern gamle docs og api-mapping fra ~/.claude/ (konsolidert i skills)
echo "2️⃣  Fjerner gamle docs og api-mapping fra ~/.claude/..."

for old_dir in docs api-mapping; do
  if [ -d "$HOME/.claude/$old_dir" ]; then
    rm -rf "$HOME/.claude/$old_dir"
    echo "   ✅ Fjernet: ~/.claude/$old_dir/"
  else
    echo "   ⏭️  Fantes ikke: ~/.claude/$old_dir/"
  fi
done

echo ""

# 4. Fjern skills fra ~/.claude/skills/
echo "4️⃣  Fjerner skills fra ~/.claude/skills/..."

SKILLS=(
  "aide-analyser"
  "aide-lag-tester"
  "aide-løs"
  "aide-opprett"
  "aide-react-class-to-func"
  "aide-to-html"
  "aide-to-pdf"
  "architecture-advisor"
  "task-workflow-assistant"
  "tdd-coach"
)

for skill in "${SKILLS[@]}"; do
  if [ -d "$HOME/.claude/skills/$skill" ]; then
    rm -rf "$HOME/.claude/skills/$skill"
    echo "   ✅ Fjernet: ~/.claude/skills/$skill"
  else
    echo "   ⏭️  Fantes ikke: ~/.claude/skills/$skill"
  fi
done

echo ""

# 5. Fjern gamle commands fra ~/.claude/commands/ (migrert til skills)
echo "5️⃣  Fjerner gamle commands fra ~/.claude/commands/..."

if [ -d "$HOME/.claude/commands" ]; then
  rm -rf "$HOME/.claude/commands"
  echo "   ✅ Fjernet: ~/.claude/commands/ (konsolidert i skills)"
else
  echo "   ⏭️  ~/.claude/commands/ fantes ikke"
fi

echo ""

# 6. Fjern agents fra ~/.claude/agents/
echo "6️⃣  Fjerner agents fra ~/.claude/agents/..."

if [ -f "$HOME/.claude/agents/task-analyzer.md" ]; then
  rm "$HOME/.claude/agents/task-analyzer.md"
  echo "   ✅ Fjernet: ~/.claude/agents/task-analyzer.md"
else
  echo "   ⏭️  Fantes ikke: ~/.claude/agents/task-analyzer.md"
fi

echo ""

# 7. Fjern rules fra ~/.claude/rules/
echo "7️⃣  Fjerner rules fra ~/.claude/rules/..."

RULES=(
  "tools-and-scripts.md"
  "workflows.md"
  "llm-disiplin.md"
  "git.md"
  "testing.md"
  "documentation.md"
  "markdown-linting.md"
  "report-structure.md"
  "communication.md"
)

for rule in "${RULES[@]}"; do
  if [ -f "$HOME/.claude/rules/$rule" ]; then
    rm "$HOME/.claude/rules/$rule"
    echo "   ✅ Fjernet: ~/.claude/rules/$rule"
  else
    echo "   ⏭️  Fantes ikke: ~/.claude/rules/$rule"
  fi
done

echo ""

echo "✅ Avinstallasjon fullført!"
echo ""
echo "💡 For å installere på nytt:"
echo "   cd $(dirname "$0")"
echo "   ./install.sh"
echo ""
