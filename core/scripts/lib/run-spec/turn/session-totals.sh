#!/usr/bin/env bash
# run-spec/turn/session-totals.sh — sourced by aide-run-spec before run-spec/turn/model-turn.sh.
#
# A Claude result reports the SESSION's totals: after `--resume`, its
# `total_cost_usd` and `modelUsage` include every earlier turn of that
# session, in this run or an earlier one. The runner records each session's
# totals after every Claude turn, and a turn that resumed a recorded session
# reports
#   - `cost`: what this turn added, since the callers add a step's turns up;
#   - `tokens_json`: what the session used since this run's first turn on it,
#     since the callers keep the last turn's tokens as the step's. What an
#     earlier step counted (the analysis an implement continues, an earlier
#     implement attempt) is left out.
# A session with no record, or a turn that started a session, reports what
# the result says.

session_totals_dir="${AIDE_SESSION_TOTALS_DIR:-$HOME/.aide/run-spec/session-totals}"

# The session the current argv resumes, or nothing.
resumed_session() {
  local prev="" arg
  for arg in "${argv[@]}"; do
    [ "$prev" = "--resume" ] && { printf '%s' "$arg"; return 0; }
    prev="$arg"
  done
}

# Turn this Claude turn's session totals into what the turn and the step
# used, and record the session's new totals. <session> is the one the result
# names, <resumed> the one the argv resumed, <result json> the result event.
session_totals_apply() {
  local session="$1" resumed="$2" result="$3" record base_file now before
  case "$session" in ''|*/*) return 0 ;; esac
  record="$session_totals_dir/$session.json"
  base_file="$work_dir/session-step-base-$session.json"
  now="$(jq -cn --arg cost "${cost:-0}" --argjson tokens "${tokens_json:-null}" \
    '{cost: ($cost | tonumber? // 0), tokens: $tokens}')" || return 0
  if [ "$resumed" = "$session" ] && [ -f "$record" ]; then
    before="$(cat "$record")"
    [ -f "$base_file" ] || jq -c '.tokens' <<<"$before" > "$base_file"
    cost="$(jq -rn --argjson b "$before" --argjson n "$now" \
      '[($n.cost - ($b.cost // 0)), 0] | max')"
    # Only `modelUsage` is the session's total; the flat `usage` fallback is
    # the last call alone and has nothing to subtract.
    if [ -n "${tokens_json:-}" ] && jq -e '(.modelUsage | type) == "object" and (.modelUsage | length) > 0' \
        <<<"$result" >/dev/null 2>&1; then
      tokens_json="$(jq -c --slurpfile base "$base_file" '
        ($base[0] // {}) as $b
        | {input:         ([.input - ($b.input // 0), 0] | max),
           output:        ([.output - ($b.output // 0), 0] | max),
           cacheRead:     ([.cacheRead - ($b.cacheRead // 0), 0] | max),
           cacheCreation: ([.cacheCreation - ($b.cacheCreation // 0), 0] | max)}
        | . + {total: (.input + .output + .cacheRead + .cacheCreation)}
      ' <<<"$tokens_json")"
    fi
  else
    [ -f "$base_file" ] || echo null > "$base_file"
  fi
  mkdir -p "$session_totals_dir" 2>/dev/null || return 0
  printf '%s\n' "$now" > "$record.tmp" && mv "$record.tmp" "$record"
  # A record matters only while its session can still be continued.
  find "$session_totals_dir" -name '*.json' -mtime +2 -delete 2>/dev/null || true
}
