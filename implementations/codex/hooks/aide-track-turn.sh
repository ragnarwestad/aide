#!/usr/bin/env bash
# Record what happened during the turn, for aide-stop-guard.sh to judge at Stop.
#
# Claude Code solves the Stop guard with a prompt hook; Codex only has command
# hooks, so the state is tracked explicitly: a source-code edit marks the turn
# "code-changed", a test/type-check command marks it "tests-run". Markers live
# under $TMPDIR per session and turn.

payload=$(cat)
session=$(jq -r '.session_id // "session"' <<<"$payload")
turn=$(jq -r '.turn_id // "turn"' <<<"$payload")
tool=$(jq -r '.tool_name // empty' <<<"$payload")
state_dir="${TMPDIR:-/tmp}/aide-codex-hooks/$session"

case "$tool" in
  Bash)
    cmd=$(jq -r '.tool_input.command // empty' <<<"$payload")
    if echo "$cmd" | grep -qE '(^|[ /])((pnpm|npm|yarn) (run )?test|vitest|jest|tsc|pytest|gradlew?|mvn|go test|cargo test)'; then
      mkdir -p "$state_dir"
      touch "$state_dir/$turn.tests-run"
    fi
    ;;
  *)
    files=$(jq -r '.tool_input.file_path // empty' <<<"$payload")
    if [ -z "$files" ]; then
      files=$(jq -r '.tool_input.command // .tool_input.input // empty' <<<"$payload" |
        sed -nE 's/^\*\*\* (Add|Update) File: (.*)$/\2/p')
    fi
    if echo "$files" | grep -qE '\.(ts|tsx|js|jsx|kt|java)$'; then
      mkdir -p "$state_dir"
      touch "$state_dir/$turn.code-changed"
    fi
    ;;
esac
exit 0
