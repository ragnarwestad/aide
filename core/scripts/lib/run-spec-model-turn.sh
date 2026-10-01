#!/usr/bin/env bash
# run-spec-model-turn.sh — sourced by aide-run-spec before run-spec-spec-paths.sh.
#
# The model's one turn, and the reading of what came back, for claude,
# codex and opencode alike. A function, defined here and called from
# run-spec-spec-paths.sh (the step's own turn and the analysis-session
# retry), run-spec-review.sh (the review and its fix turn) and
# run-spec-step-tests.sh (a fix turn after red tests).

# One turn of the model: run `argv` on the prompt in $1, wait it out under
# the step's deadline, and read the result back into the step's own
# globals ($terminal_reason, $error_msg, $cost, $session_out, ...). A
# function so run-spec-step-tests.sh can ask for another turn — the same
# session resumed with the red suite's output — without a second copy of
# any of this. The transcript is appended to, so every turn of one step
# is in the one stream the dashboard shows.
run_model_turn() {
  # The transcript's size says where this turn's output begins: the dashboard
  # cuts the transcript there to put Aide's own lines between the turns.
  local turn_at resume_part="$aide_part"
  turn_at="$({ wc -c < "$transcript"; } 2>/dev/null | tr -d ' ')"
  # The Aide part this turn interrupts ends here, and picks up again
  # after it — except preparing, which a turn always ends.
  aide_part_close
  stage "model turn started (transcript at byte ${turn_at:-0})"
  # `set -m` puts the child in its OWN process group, so the deadline can
  # take down claude's children too — a kill that only reaches the parent
  # is not a bound. No pipeline here: with one, $! is the last command and
  # the group id would be someone else's.
  set -m
  # cd into the project's WORKTREE first. A skill resolves the project from
  # its working directory, so inheriting the caller's cwd (a server's, say)
  # makes the run analyse the wrong repository — measured on the first
  # real job, 2026-08-16, which cost $0.45 to discover. Since spec 91 the
  # directory is the throwaway checkout, which is the tree this run will
  # commit from. `exec` keeps the pid, so $! is still the process group we
  # later signal.
  ( cd "$project_wt" && AIDE_HEADLESS=1 exec "${argv[@]}" ) < "$1" >> "$transcript" 2>> "$work_dir/err" &
  child=$!
  set +m

  stopped=""
  deadline=$(( started_at + ${timeout_sec%.*} ))
  while kill -0 "$child" 2>/dev/null; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      stopped="timeout"
      # SIGTERM first, always: a run being asked to stop is exactly when a
      # few extra seconds are cheapest.
      kill_group TERM
      grace_end=$(( $(date +%s) + ${kill_grace_sec%.*} ))
      while kill -0 "$child" 2>/dev/null && [ "$(date +%s)" -lt "$grace_end" ]; do sleep 0.2; done
      kill -0 "$child" 2>/dev/null && kill_group KILL
      break
    fi
    sleep 0.2
  done
  wait "$child" 2>/dev/null
  exit_code=$?
  # The turn is over; whatever it started and left running — a suite's
  # board, a decoy server — is stopped with its group, not left to hold
  # ports and slow every later run (2026-09-19).
  kill_group TERM
  duration=$(( $(date +%s) - started_at ))

# --- reading what came back --------------------------------------------------
session_out=""; subtype=""; cost="0"; cost_measured="false"; terminal_reason=""; error_msg=""
# The turn's own final text — the one piece of "what came back" nothing
# reads today. Reset here, unconditionally like the globals above, for
# `set -u` safety: a caller reading it on a path where no branch below
# sets it would abort the whole run.
turn_message=""
# The tokens the step actually metered, as a JSON object — or empty,
# which is what makes the field ABSENT rather than zero (spec 118).
tokens_json=""
# The model id the run's own log names (`system`/`init`), or empty, which
# makes the result's `modelId` ABSENT rather than a guess.
model_id_out=""
# The provider's own account of a usage limit that stopped this turn, in
# the one shape `run-spec-provider-limit.sh` writes for every tool — or
# empty, which leaves `providerLimit` out of the result.
provider_limit_out=""
# Did the tool report an outcome of its own at all? For claude this is
# the same question as "was a cost measured", which is why the branch
# below used to ask that one — but a Codex step never measures a cost
# and still finishes, so the two questions had to come apart (spec 125).
have_result="false"
# Is there a dollar figure to report? Claude sets one on every path,
# including the over-charge a killed run is billed. Codex publishes no
# dollar figure anywhere in its output and there is nothing to
# approximate one from, so the field is left out of the result entirely
# rather than defaulted to a number somebody would read as real.
cost_known="true"
[ "$tool" = "codex" ] && cost_known="false"

# The stream holds one event per line, so the result must be SELECTED by
# `type == "result"`, never taken positionally: the CLI emits shutdown
# and rate-limit events after it, and "the last line" would silently
# report the wrong cost, session and terminal reason for every run.
# `-R` + `fromjson?` reads line by line and skips anything that does not
# parse, so a half-written final line from a killed run costs nothing
# rather than discarding a result event that arrived intact.
if [ "$tool" = "codex" ]; then
  # Codex's own closing event. Selected by type for exactly the reason
  # claude's is: `codex exec --json` keeps emitting after the turn ends,
  # and "the last line" would report the wrong thing every run. A failed
  # turn is a result too — it says the step ran and did not finish,
  # which is a different answer from "the CLI never said anything".
  result_json="$(jq -Rc 'fromjson? | select(type == "object" and (.type == "turn.completed" or .type == "turn.failed"))' \
    "$transcript" 2>/dev/null | tail -n 1)"
  # The thread Codex named for itself, read back the way claude's
  # session id is. It arrives FIRST, in `thread.started`, not in the
  # closing event — so it is picked out of its own event.
  session_out="$(jq -Rr 'fromjson? | select(type == "object" and .type == "thread.started") | .thread_id // empty' \
    "$transcript" 2>/dev/null | tail -n 1)"
  # The turn's own final text: the last `item.completed` event whose item
  # is an agent_message — a shape nothing else in this branch reads today.
  # Selected as a whole EVENT first (compact, so `tail -n 1` counts events
  # rather than lines) and only THEN read for `.item.text`: that text can
  # carry its own embedded newlines, which `-r`'s raw output would split
  # across several lines and `tail -n 1` would then truncate to the last
  # one alone.
  turn_message_json="$(jq -Rc 'fromjson? | select(type == "object" and .type == "item.completed" and .item.item_type == "agent_message")' \
    "$transcript" 2>/dev/null | tail -n 1)"
  turn_message=""
  [ -n "$turn_message_json" ] && turn_message="$(jq -r '.item.text // empty' <<<"$turn_message_json" 2>/dev/null)"
  if [ -n "$result_json" ]; then
    have_result="true"
    case "$(jq -r '.type' <<<"$result_json")" in
      turn.completed) subtype="success" ;;
      *) subtype="turn_failed"
         error_msg="$(jq -r '(.error.message // .error // "the turn failed") | tostring' <<<"$result_json")" ;;
    esac
    # Codex's usage block, mapped into the shape spec 118 already
    # defined. Two of the four need saying out loud: reasoning tokens
    # are BILLED AS OUTPUT and so are added to it rather than dropped,
    # and Codex exposes no separate cache-WRITE count at all — zero
    # there is the measurement, not a placeholder for a missing one.
    tokens_json="$(jq -c '
      if (.usage | type) == "object" then
        {input:         (.usage.input_tokens // 0),
         output:        ((.usage.output_tokens // 0) + (.usage.reasoning_output_tokens // 0)),
         cacheRead:     (.usage.cached_input_tokens // 0),
         cacheCreation: 0}
        | . + {total: (.input + .output + .cacheRead + .cacheCreation)}
      else empty end
    ' <<<"$result_json" 2>/dev/null)"
  fi
  # A turn that did not complete may have been stopped by the account's
  # own limit, which `codex exec --json` never names. Codex's session
  # file does.
  if [ "$subtype" != "success" ]; then
    provider_limit_out="$(codex_provider_limit "$session_out")"
  fi
elif [ "$tool" = "opencode" ]; then
  # opencode closes no turn with a single result event. It emits one
  # `step_finish` per step, each carrying that step's own tokens and
  # cost, so the run's totals are the SUM over all of them — taking the
  # last one alone would report the final step's numbers as the whole
  # run's. A turn that failed says so in an `error` event instead, and
  # that event wins: it is the only place a message to show the reader
  # exists. Verified 2026-09-16 against opencode 1.18.31, whose error
  # event carries `.error.name` with the human sentence under
  # `.error.data.message`.
  error_json="$(jq -Rc 'fromjson? | select(type == "object" and .type == "error")' \
    "$transcript" 2>/dev/null | tail -n 1)"
  # Every event carries the session opencode named for itself, so the
  # first one that parses answers it — including for a run that failed
  # before any step finished.
  session_out="$(jq -Rr 'fromjson? | select(type == "object") | .sessionID // empty' \
    "$transcript" 2>/dev/null | head -n 1)"
  # The turn's own final text: the last `text` part — a shape nothing
  # else in this branch reads today. Selected as a whole event first,
  # same reason as codex's own read above: the text can carry embedded
  # newlines that raw (`-r`) output would split across lines before
  # `tail -n 1` ever saw them.
  turn_message_json="$(jq -Rc 'fromjson? | select(type == "object" and .part.type == "text")' \
    "$transcript" 2>/dev/null | tail -n 1)"
  turn_message=""
  [ -n "$turn_message_json" ] && turn_message="$(jq -r '.part.text // empty' <<<"$turn_message_json" 2>/dev/null)"
  steps_json="$(jq -Rsc '
    [splits("\n") | select(length > 0) | fromjson?
     | select(type == "object" and .type == "step_finish") | .part]
    | {cost:          (map(.cost // 0)                  | add // 0),
       input:         (map(.tokens.input // 0)          | add // 0),
       output:        (map((.tokens.output // 0) + (.tokens.reasoning // 0)) | add // 0),
       cacheRead:     (map(.tokens.cache.read // 0)     | add // 0),
       cacheCreation: (map(.tokens.cache.write // 0)    | add // 0),
       steps:         length}
  ' "$transcript" 2>/dev/null)"
  if [ -n "$error_json" ]; then
    have_result="true"
    subtype="turn_failed"
    error_msg="$(jq -r '(.error.data.message // .error.name // "the turn failed") | tostring' <<<"$error_json")"
  elif [ "$(jq -r '.steps // 0' <<<"${steps_json:-{\}}" 2>/dev/null)" != "0" ]; then
    have_result="true"
    subtype="success"
  fi
  if [ "$have_result" = "true" ] && [ -n "$steps_json" ]; then
    # Reasoning tokens are added to output for the reason codex's are:
    # they are billed as output, so dropping them understates the run.
    cost="$(jq -r '.cost' <<<"$steps_json")"
    cost_measured="true"
    tokens_json="$(jq -c '{input, output, cacheRead, cacheCreation}
      | . + {total: (.input + .output + .cacheRead + .cacheCreation)}' <<<"$steps_json")"
  fi
else
result_json="$(jq -Rc 'fromjson? | select(type == "object" and .type == "result")' \
  "$transcript" 2>/dev/null | tail -n 1)"
# The model the CLI says it started on: the `init` event, not `modelUsage`,
# which lists helper models too. The last `init` that names one wins, like
# the last `result` (a resumed turn writes its own). A stand-in names no
# real model, so `fake-claude` reads nothing.
if [ "$tool" = "claude" ]; then
  model_id_out="$(jq -Rr 'fromjson?
    | select(type == "object" and .type == "system" and .subtype == "init")
    | .model | select(type == "string" and length > 0)' \
    "$transcript" 2>/dev/null | tail -n 1)"
fi
# `status: rejected` alone is NOT a stop: it says the subscription
# window is spent, and the very same event says whether purchased
# credit is carrying the request anyway. Measured 2026-08-25, when
# every run for two days was reported stopped while finishing its
# work — the seven-day window was spent, `overageStatus: allowed`
# and `isUsingOverage: true` covered every call, and the branch that
# wins below is ahead of the one that reads the successful result.
# A real stop has the credit refused beside it
# (`overageStatus: rejected`, `overageDisabledReason: out_of_credits`,
# `isUsingOverage: false`), so the credit in use is what tells the two
# apart. Absent means false: an older CLI emitted neither field.
provider_limit_json="$(jq -Rc 'fromjson? | select(
  type == "object" and .type == "rate_limit_event" and
  .rate_limit_info.status == "rejected" and
  (.rate_limit_info.isUsingOverage // false) == false
)' "$transcript" 2>/dev/null | tail -n 1)"
if [ -n "$provider_limit_json" ]; then
  provider_limit_out="$(claude_provider_limit "$provider_limit_json")"
  # The event IS the stop; a shape that could not be read still is one.
  [ -n "$provider_limit_out" ] || provider_limit_out='{"tool":"claude","window":"provider"}'
fi

if [ -n "$result_json" ]; then
  have_result="true"
  session_out="$(jq -r '.session_id // empty' <<<"$result_json")"
  subtype="$(jq -r '.subtype // empty' <<<"$result_json")"
  cost="$(jq -r '.total_cost_usd // 0' <<<"$result_json")"
  cost_measured="true"
  # The turn's own final text: the same result event already parsed for
  # session_id/cost above — free, no new scan of $transcript.
  turn_message="$(jq -r '.result // empty' <<<"$result_json")"
  # What the plan actually meters. On a subscription the dollar figure is
  # notional and this is the number that counts, so it is recorded beside
  # the cost rather than instead of it.
  #
  # `modelUsage` FIRST and summed across its models: it is the session's
  # own total, keyed by model, and a run that switched model mid-session
  # has a block each. The flat `usage` is the fallback because it holds
  # the LAST TURN alone — right shape, wrong span — and is worth reading
  # only when the per-model block is not there at all. Neither present
  # emits nothing: a token count can be measured or absent, never
  # assumed, so there is no equivalent of the over-charge rule below.
  tokens_json="$(jq -c '
    (.modelUsage // {} | if type == "object" then [.[]] else [] end) as $models
    | (if ($models | length) > 0 then
         {input:         ($models | map(.inputTokens // 0)              | add),
          output:        ($models | map(.outputTokens // 0)             | add),
          cacheRead:     ($models | map(.cacheReadInputTokens // 0)     | add),
          cacheCreation: ($models | map(.cacheCreationInputTokens // 0) | add)}
       elif (.usage | type) == "object" then
         {input:         (.usage.input_tokens // 0),
          output:        (.usage.output_tokens // 0),
          cacheRead:     (.usage.cache_read_input_tokens // 0),
          cacheCreation: (.usage.cache_creation_input_tokens // 0)}
       else empty end)
    # Cached or not, every one of these was processed — which is what
    # the plan bills against.
    | . + {total: (.input + .output + .cacheRead + .cacheCreation)}
  ' <<<"$result_json" 2>/dev/null)"
fi
fi

if [ -n "$stopped" ]; then
  terminal_reason="timeout"
  # A SIGKILLed run prints nothing, so the cost cannot be measured.
  cost="0"; cost_measured="false"
  # A SIGTERM'd run DOES flush a result, usage block and all — and it is
  # no more trustworthy than the cost above. Neither is charged for what
  # could not be measured; the token count is dropped rather than
  # half-reported.
  tokens_json=""
  # A limit WE set, not something that happened to us — and spec 146's
  # commit below has already put the work on the branch, so the step
  # can be re-run from where it got to. The row says "press Run"
  # separately (`nextActionHint`); this sentence only has to say why
  # and that nothing was lost.
  error_msg="stopped at its own ${timeout_sec}s time limit for this step"
  error_msg="$error_msg — work up to that point is committed to the branch"
# "Did the tool say how it went", not "was a cost measured" — the two
# are the same question for claude and different for codex, which
# finishes perfectly well without ever naming a dollar figure.
elif [ -n "${provider_limit_out:-}" ]; then
  terminal_reason="provider-limit"
  limit_type="$(jq -r '.window // "provider" | gsub("_"; " ")' <<<"$provider_limit_out")"
  reset_at="$(jq -r '.resetsAt // empty' <<<"$provider_limit_out")"
  error_msg="$limit_type provider limit reached — press $step_button again once it resets"
  [ -n "$reset_at" ] && error_msg="$error_msg; resets $reset_at"
elif [ "$have_result" = "true" ]; then
  is_error="$(jq -r '.is_error // false' <<<"$result_json")"
  if [ "$is_error" = "true" ] && [ "$(jq -r '.stop_reason // empty' <<<"$result_json")" = "refusal" ]; then
    # The model's own stop, not the CLI failing: the result's `stop_reason` says so.
    terminal_reason="model-refused"
    error_msg="$step_button stopped: the model declined to continue — press $step_button again, or choose another model for this step"
  elif [ "$is_error" = "true" ]; then
    terminal_reason="cli-error"
    error_msg="$(jq -r '(.errors // []) | join("; ")' <<<"$result_json")"
    [ -n "$error_msg" ] || error_msg="provider reported an error"
    error_msg="$error_msg — press $step_button again"
  elif [ "$exit_code" -ne 0 ]; then
    terminal_reason="cli-error"
    error_msg="$tool exit $exit_code — press $step_button again"
  else
  case "$subtype" in
    success) terminal_reason="completed" ;;
    # The codex branch above has already put the turn's own message
    # here; only claude's shape needs digging out at this point.
    *) terminal_reason="cli-error"
       [ -n "$error_msg" ] || error_msg="$(jq -r '(.errors // []) | join("; ")' <<<"$result_json")"
       error_msg="$error_msg — press $step_button again" ;;
  esac
  fi
else
  terminal_reason="cli-error"
  cost="0"; cost_measured="false"
  error_msg="$(tail -c 400 "$work_dir/err" 2>/dev/null | tr '\n' ' ')"
  [ -n "$error_msg" ] || error_msg="$tool produced no result JSON (exit $exit_code)"
  error_msg="$error_msg — press $step_button again"
fi
[ -n "$resume_part" ] && [ "$resume_part" != "preparing" ] && aide_part_open "$resume_part"
return 0
}
