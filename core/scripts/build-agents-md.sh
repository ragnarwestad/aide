#!/usr/bin/env bash

# build-agents-md.sh — Bygger core/AGENTS.md fra felles intro + felles regler
#
# Kilder:
#   core/agents-intro.md   (kort, verktøy-nøytral intro)
#   core/rules/*.md         (felles regler — én kilde for alle AI-verktøy)
#
# Output:
#   core/AGENTS.md          (Copilot installerer som copilot-instructions.md, Codex som ~/.codex/AGENTS.md)

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WORKSPACE_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
RULES_DIR="$WORKSPACE_ROOT/core/rules"
INTRO="$WORKSPACE_ROOT/core/agents-intro.md"
OUTPUT="$WORKSPACE_ROOT/core/AGENTS.md"

# Rekkefølge for regler (viktigst først)
RULE_FILES="tools-and-scripts workflows llm-disiplin git testing documentation markdown-linting report-structure communication"

# Verifiser kilder
if [ ! -f "$INTRO" ]; then
  echo "❌ Mangler: core/agents-intro.md"
  exit 1
fi

# Bygg AGENTS.md
cat "$INTRO" > "$OUTPUT"

for rule in $RULE_FILES; do
  if [ -f "$RULES_DIR/$rule.md" ]; then
    echo "" >> "$OUTPUT"
    echo "---" >> "$OUTPUT"
    echo "" >> "$OUTPUT"
    cat "$RULES_DIR/$rule.md" >> "$OUTPUT"
  fi
done

LINES=$(wc -l < "$OUTPUT" | tr -d ' ')
echo "✅ Bygget: core/AGENTS.md ($LINES linjer)"
echo "   Intro + $(echo $RULE_FILES | wc -w | tr -d ' ') regelfiler fra core/rules/"
