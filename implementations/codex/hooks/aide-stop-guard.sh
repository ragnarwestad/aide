#!/usr/bin/env bash
# Refuse to end a turn where source code changed but no tests were run.
# Port of the Claude Code Stop prompt hook in implementations/claude-code/settings.json,
# built on the markers that aide-track-turn.sh writes during the turn.
#
# stop_hook_active means this Stop was already blocked once — always allow
# then, to prevent infinite loops (same rule as the Claude Code hook).

payload=$(cat)
active=$(jq -r '.stop_hook_active // false' <<<"$payload")
session=$(jq -r '.session_id // "session"' <<<"$payload")
turn=$(jq -r '.turn_id // "turn"' <<<"$payload")
state_dir="${TMPDIR:-/tmp}/aide-codex-hooks/$session"

if [ "$active" != "true" ] &&
   [ -e "$state_dir/$turn.code-changed" ] &&
   [ ! -e "$state_dir/$turn.tests-run" ]; then
  echo '{"decision": "block", "reason": "Source code was changed this turn, but no test or type check was run. Run the project test command in single-run mode (or a type check) before finishing."}'
  exit 0
fi

rm -f "$state_dir/$turn".* 2>/dev/null
exit 0
