#!/usr/bin/env bash

# build-agents-md.sh — Builds core/AGENTS.md from the shared intro + shared rules
#
# Sources:
#   core/agents-intro.md   (short, tool-neutral intro)
#   core/rules/*.md         (shared rules — one source for all AI tools)
#
# Output:
#   core/AGENTS.md          (Copilot installs it as copilot-instructions.md, Codex as ~/.codex/AGENTS.md)

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WORKSPACE_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
RULES_DIR="$WORKSPACE_ROOT/core/rules"
INTRO="$WORKSPACE_ROOT/core/agents-intro.md"
OUTPUT="$WORKSPACE_ROOT/core/AGENTS.md"

# Order of the rules (most important first)
RULE_FILES="tools-and-scripts workflows llm-discipline git testing documentation markdown-linting report-structure communication"

# Verify sources
if [ ! -f "$INTRO" ]; then
  echo "❌ Missing: core/agents-intro.md"
  exit 1
fi

# Build AGENTS.md
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
echo "✅ Built: core/AGENTS.md ($LINES lines)"
echo "   Intro + $(echo $RULE_FILES | wc -w | tr -d ' ') rule files from core/rules/"
