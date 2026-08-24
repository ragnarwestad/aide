#!/usr/bin/env bash
# Lint markdown files right after they are edited.
# Port of the Claude Code PostToolUse hook in implementations/claude-code/settings.json.
#
# Codex edits files with apply_patch, whose input is a patch document rather
# than a file path, so the paths are extracted from "*** Add/Update File:"
# lines when tool_input.file_path is absent. AIDE_MARKDOWNLINT_CMD overrides
# the lint command (used by the tests).

payload=$(cat)
files=$(jq -r '.tool_input.file_path // empty' <<<"$payload")
if [ -z "$files" ]; then
  files=$(jq -r '.tool_input.command // .tool_input.input // empty' <<<"$payload" |
    sed -nE 's/^\*\*\* (Add|Update) File: (.*)$/\2/p')
fi

while IFS= read -r file; do
  [ -n "$file" ] || continue
  case "$file" in
    *.md)
      if [ -n "${AIDE_MARKDOWNLINT_CMD:-}" ]; then
        $AIDE_MARKDOWNLINT_CMD "$file" 2>&1
      elif command -v markdownlint-cli2 >/dev/null 2>&1; then
        markdownlint-cli2 "$file" 2>&1
      else
        echo "Markdown validation skipped: markdownlint-cli2 is not installed locally" >&2
      fi
      ;;
  esac
done <<<"$files"
exit 0
