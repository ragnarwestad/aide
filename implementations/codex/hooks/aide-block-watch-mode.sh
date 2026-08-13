#!/usr/bin/env bash
# Block `pnpm test` without --run — watch mode never exits, which hangs the agent.
# Port of the Claude Code PreToolUse hook in implementations/claude-code/settings.json.
# Payload arrives on stdin; exit 2 with a reason on stderr denies the command.

CMD=$(jq -r '.tool_input.command // empty')
if echo "$CMD" | grep -qE 'pnpm test' && ! echo "$CMD" | grep -q -- '--run'; then
  echo 'Blocked: Use pnpm test -- --run (not watch mode)' >&2
  exit 2
fi
exit 0
