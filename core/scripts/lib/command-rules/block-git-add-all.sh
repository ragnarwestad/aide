#!/usr/bin/env bash
# Block `git add .` and `git add -A` — the git rules require explicit file names.
# The one copy of this rule: Claude Code and Codex both run it as a PreToolUse
# Bash hook, from ~/.local/bin/lib/command-rules/ where every installer puts it.
# Payload arrives on stdin; exit 2 with a reason on stderr denies the command.

CMD=$(jq -r '.tool_input.command // empty')
if echo "$CMD" | grep -qE 'git (.*\s)?add (\.(\s|$)|-A(\s|$))'; then
  echo 'Blocked: Use explicit file names with git add' >&2
  exit 2
fi
exit 0
