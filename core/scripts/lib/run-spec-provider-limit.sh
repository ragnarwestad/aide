#!/usr/bin/env bash
# What a provider said about its own usage limit, in one shape for every
# tool the runner can read it from. `run_model_turn` calls these once a
# turn has ended; no model is involved, so they work exactly when the
# account is spent.
#
# The shape, with an absent field left out rather than null:
#   {tool, window, resetsAt, windows: [{name, usedPercent, resetsAt}], plan, credit}
# `window` names the window that ran out; `windows` is every window the
# tool reported, so a reader sees the weekly figure beside the five-hour
# one. `plan` and `credit` are said only by the tool that says them.
#
# opencode has no reader here: it relays whichever provider it was
# logged in to, and no run of it has hit a limit to read one from.

# Claude: its own `rate_limit_event`, already selected as a real stop
# (spent, and no purchased credit carrying the request).
claude_provider_limit() {   # $1: the event, as JSON
  jq -c '
    def iso: if type == "number" then todateiso8601 else tostring end;
    .rate_limit_info as $i
    | {tool: "claude",
       window: ($i.rateLimitType // "provider"),
       resetsAt: (if $i.resetsAt == null then null else ($i.resetsAt | iso) end)}
      + (if ($i.unifiedWindows | type) == "object" then
           {windows: [$i.unifiedWindows | to_entries[]
                      | {name: .key,
                         usedPercent: ((.value.utilization // 0) * 100 | round),
                         resetsAt: (if .value.resetsAt == null then null else (.value.resetsAt | iso) end)}
                      | with_entries(select(.value != null))]}
         else {} end)
      + (if ($i.overageDisabledReason // "") != "" then {credit: $i.overageDisabledReason} else {} end)
    | with_entries(select(.value != null))
  ' <<<"$1" 2>/dev/null
}

# Codex: `codex exec --json` says nothing about limits. Its own session
# file does — every `token_count` event carries the account's windows,
# the plan, and which window ran out — and it is named after the thread
# the turn already reported, under CODEX_HOME the way Codex itself
# resolves it. Prints nothing unless a window is full or Codex says one
# was reached: a failed turn with room left is some other failure. The
# newest count that CARRIES a window is read: a spent session ends on a
# count for another limit (`premium`) with none, after the one that ran out.
codex_provider_limit() {   # $1: the thread id
  local thread="$1" home="${CODEX_HOME:-$HOME/.codex}" file=""
  [ -n "$thread" ] && [ -d "$home/sessions" ] || return 0
  file="$(find "$home/sessions" -type f -name "rollout-*-$thread.jsonl" 2>/dev/null | head -n 1)"
  [ -n "$file" ] || return 0
  jq -Rc 'fromjson? | select(type == "object" and (.payload | type) == "object"
            and .payload.type == "token_count" and (.payload.rate_limits | type) == "object"
            and ((.payload.rate_limits.primary | type) == "object"
                 or (.payload.rate_limits.secondary | type) == "object"
                 or .payload.rate_limits.rate_limit_reached_type != null))
          | .payload.rate_limits' "$file" 2>/dev/null \
    | tail -n 1 \
    | jq -c '
      def iso: if type == "number" then todateiso8601 else tostring end;
      def name($m): if $m == 300 then "five_hour" elif $m == 10080 then "seven_day" else "\($m)_minutes" end;
      [ (.primary, .secondary) | select(type == "object")
        | {name: name(.window_minutes),
           usedPercent: ((.used_percent // 0) | round),
           resetsAt: (if .resets_at == null then null else (.resets_at | iso) end)}
        | with_entries(select(.value != null)) ] as $w
      | ([ $w[] | select(.usedPercent >= 100) ] | first) as $full
      | if (.rate_limit_reached_type // null) == null and $full == null then empty
        else
          {tool: "codex",
           window: (if $full != null then $full.name else (.rate_limit_reached_type | tostring) end),
           resetsAt: (if $full != null then $full.resetsAt else null end),
           windows: $w}
          + (if (.plan_type // "") != "" then {plan: .plan_type} else {} end)
          | with_entries(select(.value != null))
        end
    ' 2>/dev/null
}
