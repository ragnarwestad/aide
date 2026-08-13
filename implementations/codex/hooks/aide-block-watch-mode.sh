#!/usr/bin/env bash
# Block watch-mode test runs — a watcher never exits, which hangs the agent.
# Port of the Claude Code PreToolUse hook in implementations/claude-code/settings.json.
# Payload arrives on stdin; exit 2 with a reason on stderr denies the command.
#
# Conservative superset across the supported toolchains (spec 75):
# blocking a valid command is worse than missing an exotic watcher.

CMD=$(jq -r '.tool_input.command // empty')

deny() {
  echo "Blocked: $1" >&2
  exit 2
}

if echo "$CMD" | grep -qE 'pnpm test' && ! echo "$CMD" | grep -q -- '--run'; then
  deny 'Use pnpm test -- --run (not watch mode)'
fi

# Bare vitest watches by default; "vitest run" is the single-run form.
if echo "$CMD" | grep -qE '(^|[ /])vitest($| )' &&
   ! echo "$CMD" | grep -qE '(^|[ /])vitest run($| )' &&
   ! echo "$CMD" | grep -q -- '--run'; then
  deny 'Bare vitest starts watch mode - use vitest run'
fi

if echo "$CMD" | grep -qE -- '--watch( |$|=)'; then
  deny '--watch never exits - use single-run mode'
fi

if echo "$CMD" | grep -qE -- '--continuous'; then
  deny 'gradle --continuous never exits - run the task once'
fi

if echo "$CMD" | grep -qE 'cargo watch'; then
  deny 'cargo watch never exits - use cargo test'
fi

if echo "$CMD" | grep -qE '(^|[ /])(ptw|pytest-watch)($| )'; then
  deny 'pytest-watch never exits - use pytest'
fi

exit 0
