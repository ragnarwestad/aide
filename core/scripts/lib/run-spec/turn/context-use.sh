#!/usr/bin/env bash
# run-spec/turn/context-use.sh — sourced by aide-run-spec beside run-spec/turn/provider-limit.sh.
#
# How full the step's main session got its context window, for the result
# line's `context` (the field is documented in aide-run-spec's header).
# `run_model_turn` calls context_use_turn once a turn has ended; the step's
# figures are folded as the turns go and read once, by context_use_json.
#
# What counts is the main session alone. Claude's subagents write their calls
# into the same transcript under the same session id, marked by a
# `parent_tool_use_id`; Codex's subagents and the review run in threads of
# their own, with files of their own. The review's own turn is a session of
# its own too, which review.sh leaves out with $context_use_skip.
#
# Every figure is read or it is left out: a tool that states none gives no
# `context` at all, never a zero.

# The step's figures, empty until a turn states one. A step with no model turn
# reports none.
context_fullest=""        # the most tokens one call was sent, over the whole step
context_before_checks=""  # the same, once the step's own turn had ended
context_window=""         # the window the tool states for the model
context_use_skip=""       # "yes" around a turn that is not the main session

# Claude: the highest per-call sum among the main session's `assistant`
# events in the bytes after $1 of the transcript, and the init model's
# `contextWindow` in the last `result` event there. The window is read from
# the turn's own bytes — the transcript's last result may be an earlier
# turn's — and from the init model's entry, never a helper model's.
# Prints {fullest, window} with the parts it found, or nothing.
claude_turn_context() {   # $1: the byte the turn began at
  tail -c +"$(( ${1:-0} + 1 ))" "$transcript" 2>/dev/null \
    | jq -Rnc --arg model "${model_id_out:-}" '
        [inputs | fromjson? | select(type == "object" and (.type == "assistant" or .type == "result"))] as $ev
        | ([$ev[] | select(.type == "assistant" and (.parent_tool_use_id // null) == null)
            | .message.usage | select(type == "object")
            | (.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0)]
           | max) as $fullest
        | ([[$ev[] | select(.type == "result")] | last
            | if type == "object" and ($model != "") then .modelUsage[$model].contextWindow? else empty end
            | select(type == "number")] | first) as $window
        | {fullest: $fullest, window: $window} | with_entries(select(.value != null))
      ' 2>/dev/null
}

# Codex: the thread the turn itself named, its session file, and in it the
# `token_count` events after the file's last `task_started` — a resumed turn
# appends to the same file. `last_token_usage.input_tokens` already counts the
# cached tokens, so it is the figure as it stands; a count with no `info`
# carries only rate limits. Prints {fullest, window}, or nothing.
codex_turn_context() {   # $1: the byte the turn began at
  local thread file
  thread="$(tail -c +"$(( ${1:-0} + 1 ))" "$transcript" 2>/dev/null \
    | jq -Rr 'fromjson? | select(type == "object" and .type == "thread.started") | .thread_id // empty' 2>/dev/null \
    | tail -n 1)"
  [ -n "$thread" ] || return 0
  file="$(codex_session_file "$thread")"
  [ -n "$file" ] || return 0
  jq -Rnc '
    [inputs | fromjson? | select(type == "object")] as $ev
    | ([range(0; $ev | length) | select($ev[.].payload.type? == "task_started")] | last // 0) as $from
    | [$ev[$from:][] | select(.payload.type? == "token_count" and (.payload.info | type) == "object")
       | .payload.info] as $counts
    | {fullest: ([$counts[].last_token_usage.input_tokens | numbers] | max),
       window: ([$counts[].model_context_window | numbers] | last)}
    | with_entries(select(.value != null))
  ' "$file" 2>/dev/null
}

# Fold the turn that just ended, which began at byte $1 of the transcript,
# into the step's figures: the highest call so far, and the newest window.
context_use_turn() {   # $1: the byte the turn began at
  [ -z "$context_use_skip" ] || return 0
  local figures="" fullest window
  case "$tool" in
    claude) figures="$(claude_turn_context "$1")" ;;
    codex) figures="$(codex_turn_context "$1")" ;;
  esac
  [ -n "$figures" ] || return 0
  fullest="$(jq -r '.fullest // empty' <<<"$figures" 2>/dev/null)"
  window="$(jq -r '.window // empty' <<<"$figures" 2>/dev/null)"
  case "$fullest" in
    ''|*[!0-9]*) ;;
    *) if [ -z "$context_fullest" ] || [ "$fullest" -gt "$context_fullest" ]; then context_fullest="$fullest"; fi ;;
  esac
  case "$window" in
    ''|*[!0-9]*) ;;
    *) context_window="$window" ;;
  esac
  return 0
}

# The `context` object for the result line, or nothing when no call was
# stated. The shares are each figure over the window, rounded to a whole
# number, and present only with a window above zero.
context_use_json() {
  [ -n "$context_fullest" ] || return 0
  jq -nc --argjson fullest "$context_fullest" \
    --argjson before "${context_before_checks:-null}" --argjson window "${context_window:-null}" '
    def share($n): if $n == null then null else ($n * 100 / $window | round) end;
    {fullest: $fullest, beforeChecks: $before, window: $window}
    + (if ($window // 0) > 0
       then {fullestPercent: share($fullest), beforeChecksPercent: share($before)} else {} end)
    | with_entries(select(.value != null))
  ' 2>/dev/null
}
