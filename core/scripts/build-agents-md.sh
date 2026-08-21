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
RULE_FILES="tools-and-scripts workflows llm-discipline git testing documentation markdown-linting spec-structure communication"

# Verify sources
if [ ! -f "$INTRO" ]; then
  echo "❌ Missing: core/agents-intro.md"
  exit 1
fi

# Strip a leading YAML frontmatter block (--- ... ---). The paths frontmatter
# is Claude Code-only scoping — Copilot/Codex must get the rule body alone.
strip_frontmatter() {
  awk 'NR==1 && $0=="---" {skip=1; next} skip && $0=="---" {skip=0; next} !skip' "$1"
}

# A rule linking to a sibling rule is, in AGENTS.md, linking to a section
# of AGENTS.md itself — every rule is concatenated into this one file, one
# directory up from core/rules/. Left alone, `./spec-structure.md` points
# at core/spec-structure.md, which exists neither here nor in ~/.codex/
# nor in ~/.copilot/. Rewritten to the anchor of that rule's own title,
# the link travels with the file wherever it is installed.
anchor_of() {
  strip_frontmatter "$1" | grep -m1 '^# ' | sed 's/^# //' \
    | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9 -]//g' -e 's/ /-/g'
}

SED_ARGS=()
for rule in $RULE_FILES; do
  [ -f "$RULES_DIR/$rule.md" ] || continue
  # A link that already carries its own fragment keeps it; the file half
  # is simply dropped, because the target section is in this same file.
  SED_ARGS+=(-e "s|](\./$rule\.md#|](#|g")
  SED_ARGS+=(-e "s|](\./$rule\.md)|](#$(anchor_of "$RULES_DIR/$rule.md"))|g")
done

# Build AGENTS.md
cat "$INTRO" > "$OUTPUT"

for rule in $RULE_FILES; do
  if [ -f "$RULES_DIR/$rule.md" ]; then
    echo "" >> "$OUTPUT"
    echo "---" >> "$OUTPUT"
    echo "" >> "$OUTPUT"
    strip_frontmatter "$RULES_DIR/$rule.md" | sed "${SED_ARGS[@]}" >> "$OUTPUT"
  fi
done

LINES=$(wc -l < "$OUTPUT" | tr -d ' ')
echo "✅ Built: core/AGENTS.md ($LINES lines)"
echo "   Intro + $(echo $RULE_FILES | wc -w | tr -d ' ') rule files from core/rules/"
