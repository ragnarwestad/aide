#!/usr/bin/env bash
# run-spec/turn/session-totals.sh — sourced by aide-run-spec before run-spec/turn/model-turn.sh.
#
# A Claude result reports the SESSION's totals: after `--resume`, its
# `total_cost_usd` and `modelUsage` include every earlier turn of that
# session, in this run or an earlier one. A Codex `turn.completed` does the
# same for its thread's tokens, after `exec resume`; Codex names no cost.
# OpenCode reports each call on its own and is handled where it is read.
# The runner records each session's totals after every Claude or Codex turn,
# and a turn that resumed a recorded session reports what this turn alone
# added, in `cost` and `tokens_json`, since the callers add a step's turns
# up. What an earlier step counted (the analysis an implement continues, an
# earlier implement attempt) is left out. A session with no record, or a
# turn that started a session, reports what the result says.

session_totals_dir="${AIDE_SESSION_TOTALS_DIR:-$HOME/.aide/run-spec/session-totals}"

# The session the current argv resumes, or nothing: claude's `--resume <id>`,
# codex's `exec resume ... <thread> -`.
resumed_session() {
  local prev="" arg n=${#argv[@]}
  if [ "${argv[1]:-}" = "exec" ] && [ "${argv[2]:-}" = "resume" ] && [ "$n" -ge 2 ]; then
    printf '%s' "${argv[$((n - 2))]}"; return 0
  fi
  for arg in "${argv[@]}"; do
    [ "$prev" = "--resume" ] && { printf '%s' "$arg"; return 0; }
    prev="$arg"
  done
}

# Turn this turn's session totals into what the turn and the step used, and
# record the session's new totals. <session> is the one the result names,
# <resumed> the one the argv resumed, <cumulative tokens> yes when the tokens
# are the session's total (claude's `modelUsage`, codex's usage), not the
# last call's alone (claude's flat `usage`), which has nothing to subtract.
session_totals_apply() {
  local session="$1" resumed="$2" cumulative_tokens="$3" record now before
  case "$session" in ''|*/*) return 0 ;; esac
  record="$session_totals_dir/$session.json"
  now="$(jq -cn --arg cost "${cost:-0}" --argjson tokens "${tokens_json:-null}" \
    '{cost: ($cost | tonumber? // 0), tokens: $tokens}')" || return 0
  if [ "$resumed" = "$session" ] && [ -f "$record" ]; then
    before="$(cat "$record")"
    cost="$(jq -rn --argjson b "$before" --argjson n "$now" \
      '[($n.cost - ($b.cost // 0)), 0] | max')"
    if [ -n "${tokens_json:-}" ] && [ "$cumulative_tokens" = "yes" ]; then
      # An earlier turn that metered nothing leaves nothing to subtract
      # from, and a session total is not this turn's figure.
      tokens_json="$(jq -c --argjson b "$before" '
        $b.tokens as $b | if $b == null then empty else
          {input:         ([.input - ($b.input // 0), 0] | max),
           output:        ([.output - ($b.output // 0), 0] | max),
           cacheRead:     ([.cacheRead - ($b.cacheRead // 0), 0] | max),
           cacheCreation: ([.cacheCreation - ($b.cacheCreation // 0), 0] | max)}
          | . + {total: (.input + .output + .cacheRead + .cacheCreation)} end
      ' <<<"$tokens_json")"
    fi
  fi
  mkdir -p "$session_totals_dir" 2>/dev/null || return 0
  printf '%s\n' "$now" > "$record.tmp" && mv "$record.tmp" "$record"
  # A record matters only while its session can still be continued.
  find "$session_totals_dir" -name '*.json' -mtime +2 -delete 2>/dev/null || true
}
