#!/usr/bin/env bash
# Lint markdown files right after they are edited.
# Port of the Claude Code PostToolUse hook in implementations/claude-code/settings.json.
#
# Codex edits files with apply_patch, whose input is a patch document rather
# than a file path, so the paths are extracted from "*** Add/Update File:"
# lines when tool_input.file_path is absent. AIDE_MARKDOWNLINT_CMD overrides
# the lint command (used by the tests).

payload=$(cat)
LINT_CMD="${AIDE_MARKDOWNLINT_CMD:-npx markdownlint-cli2}"

files=$(jq -r '.tool_input.file_path // empty' <<<"$payload")
if [ -z "$files" ]; then
  files=$(jq -r '.tool_input.command // .tool_input.input // empty' <<<"$payload" |
    sed -nE 's/^\*\*\* (Add|Update) File: (.*)$/\2/p')
fi

while IFS= read -r file; do
  [ -n "$file" ] || continue
  case "$file" in
    *.md) $LINT_CMD "$file" 2>&1 ;;
  esac
done <<<"$files"
exit 0
