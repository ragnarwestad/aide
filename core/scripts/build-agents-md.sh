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

# Order of the rules (most important first).
#
# Only the rules that apply to EVERY turn are here. Codex appends at most
# project_doc_max_bytes of this file — 32768 by default — and drops the
# rest without a word, so a rule that only matters for some tasks costs
# every other rule its place in the file. The five task-specific ones
# (workflows, documentation, tools-and-scripts, markdown-linting,
# spec-structure) are skills instead, loaded when they are relevant
# (spec 147). test_core_scripts.py holds the byte budget.
RULE_FILES="llm-discipline git testing communication"

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
echo "   Intro + $(echo "$RULE_FILES" | wc -w | tr -d ' ') rule files from core/rules/"

# core/rules/spec-structure.md stays a Claude Code rule, scoped by its
# `paths` frontmatter to the spec files it is about. Codex and Copilot
# have no path-scoping at all, and the rule is far too big to inline into
# AGENTS.md, so they read the same content as a skill from
# ~/.agents/skills/. Generated from the one source rather than
# hand-copied: two copies of the spec layout that drift apart is the
# failure spec 82 spent a whole spec undoing.
SPEC_STRUCTURE_SKILL="$WORKSPACE_ROOT/core/skills/spec-structure/SKILL.md"
mkdir -p "$(dirname "$SPEC_STRUCTURE_SKILL")"
{
  cat <<'EOF'
---
name: spec-structure
description: >-
  The 4-file spec structure (1-description, 2-analysis, 3-solution,
  4-status) for JIRA issues and TODO plans: what belongs in each file,
  the required sections, and the Tracking info fields.
  Use when: creating, analyzing, reviewing, implementing or archiving a
  spec; deciding which of the four files a piece of content belongs in.
  Do NOT use for: general documentation formatting (use the documentation
  skill), the workflow around the files (use the workflows skill).
effort: medium
---

EOF
  strip_frontmatter "$RULES_DIR/spec-structure.md"
} > "$SPEC_STRUCTURE_SKILL"
echo "✅ Generated: core/skills/spec-structure/SKILL.md (from core/rules/spec-structure.md)"
