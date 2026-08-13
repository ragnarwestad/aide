#!/usr/bin/env bash
# Block `git add .` and `git add -A` — the git rules require explicit file names.
# Port of the Claude Code PreToolUse hook in implementations/claude-code/settings.json.
# Payload arrives on stdin; exit 2 with a reason on stderr denies the command.

CMD=$(jq -r '.tool_input.command // empty')
if echo "$CMD" | grep -qE 'git (.*\s)?add (\.(\s|$)|-A(\s|$))'; then
  echo 'Blocked: Use explicit file names with git add' >&2
  exit 2
fi
exit 0
