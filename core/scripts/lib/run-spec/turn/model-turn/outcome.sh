#!/usr/bin/env bash
# run-spec/turn/model-turn/outcome.sh — sourced by aide-run-spec before
# run-spec/turn/model-turn/index.sh.
#
# How one model turn ended, from what model-turn/read.sh read back: the
# step's $terminal_reason, $error_msg and $error_solution. Called from
# run_model_turn.

# A tool that ended without giving a reason.
turn_silent_error() {
  provider_error_out='{"kind":"silent"}'
  error_msg="$tool ended (exit $exit_code) without giving a reason"
  error_solution="its output is in this step's log; press $step_button again"
}

model_turn_record_totals() {
  # How full the window got in this turn's calls (run-spec/turn/context-use.sh).
  context_use_turn "${turn_at:-0}"
  # A Claude result and a Codex `turn.completed` count the whole session; the
  # turn's and the step's share of it (run-spec/turn/session-totals.sh). A stopped turn's flushed figures
  # are not believed, so they are not recorded either.
  if [ -z "$stopped" ] && [ -n "${result_json:-}" ]; then
    case "$tool" in
      opencode) ;;
      codex) session_totals_apply "$session_out" "$(resumed_session)" yes ;;
      *) session_totals_apply "$session_out" "$(resumed_session)" "$(jq -r \
           'if (.modelUsage | type) == "object" and (.modelUsage | length) > 0 then "yes" else "no" end' \
           <<<"$result_json" 2>/dev/null)" ;;
    esac
  fi
}

model_turn_outcome() {
  if [ -n "$stopped" ]; then
    terminal_reason="timeout"
    # A SIGKILLed run prints nothing, so the cost cannot be measured.
    cost="0"; cost_measured="false"
    # A SIGTERM'd run DOES flush a result, usage block and all — and it is
    # no more trustworthy than the cost above. Neither is charged for what
    # could not be measured; the token count is dropped rather than
    # half-reported.
    tokens_json=""
    # A limit WE set, not something that happened to us — and the
    # commit below has already put the work on the branch, so the step
    # can be re-run from where it got to. The row says "press Run"
    # separately (`nextActionHint`); this sentence only has to say why
    # and that nothing was lost.
    error_msg="stopped at its own $(time_limit_words "$timeout_sec") time limit for this step; work up to that point is committed to the branch"
    error_solution="press $step_button again to carry on from there"
    # The limit and that it ran out in the session, for the board's own sentence.
    time_limit_json="$(jq -cn --argjson s "$timeout_sec" '{seconds:$s, during:"session"}')"
  # "Did the tool say how it went", not "was a cost measured" — the two
  # are the same question for claude and different for codex, which
  # finishes perfectly well without ever naming a dollar figure.
  elif [ -n "${provider_limit_out:-}" ]; then
    terminal_reason="provider-limit"
    limit_type="$(jq -r '.window // "provider" | gsub("_"; " ")' <<<"$provider_limit_out")"
    reset_at="$(jq -r '.resetsAt // empty' <<<"$provider_limit_out")"
    error_msg="$limit_type provider limit reached"
    [ -n "$reset_at" ] && error_msg="$error_msg; resets $reset_at"
    error_solution="press $step_button again once it resets"
  # The provider has no room for this model right now: no reset to wait
  # for, and another model runs at once.
  elif [ -n "$at_capacity_out" ]; then
    terminal_reason="model-at-capacity"
    error_msg="$step_button stopped: ${model:-${model_id_out:-the model}} is at capacity right now"
    error_solution="press $step_button again"
  elif [ "$have_result" = "true" ]; then
    model_turn_result_outcome
  else
    model_turn_no_result_outcome
  fi
}

# The tool reported an outcome of its own.
model_turn_result_outcome() {
  is_error="$(jq -r '.is_error // false' <<<"$result_json")"
  if [ "$is_error" = "true" ] && [ "$(jq -r '.stop_reason // empty' <<<"$result_json")" = "refusal" ]; then
    # The model's own stop, not the CLI failing: the result's `stop_reason` says so.
    terminal_reason="model-refused"
    error_msg="$step_button stopped: the model declined to continue"
    error_solution="choose another model for this step, then press $step_button"
  elif [ "$is_error" = "true" ]; then
    terminal_reason="cli-error"
    # The provider's own words: the error list, or else the result's text,
    # which is where Claude Code says "Not logged in" or "API Error: 500".
    error_msg="$(jq -r 'if ((.errors // []) | length) > 0 then (.errors | join("; "))
      else (.result // "" | tostring) end' <<<"$result_json")"
    provider_error_out="$(provider_error_json "$error_msg" \
      "$(jq -r '.api_error_status // empty' <<<"$result_json")" "$claude_error_name" \
      "$(jq -r '.api_error_code // empty' <<<"$result_json")")"
    if [ -n "$error_msg" ]; then
      error_solution="$(provider_error_ending "$(jq -r .kind <<<"$provider_error_out")" "$tool" "$step_button")"
    else
      turn_silent_error
    fi
  elif [ "$subtype" = "turn_failed" ] && [ -n "$error_msg" ]; then
    # Codex's or OpenCode's own error, read above: it says why, where the
    # exit code (1) says only that it failed.
    terminal_reason="cli-error"
    # OpenCode's error event carries the HTTP status (402 for an account
    # without credit); Codex's message carries none.
    provider_error_out="$(provider_error_json "$error_msg" \
      "$(jq -r '.error.status // .error.data.statusCode // empty' <<<"${error_json:-{\}}" 2>/dev/null)")"
    error_solution="$(provider_error_ending "$(jq -r .kind <<<"$provider_error_out")" "$tool" "$step_button")"
  elif [ "$exit_code" -ne 0 ] && [ "$(jq -r '(.errors // []) | length' <<<"$result_json")" -eq 0 ]; then
    terminal_reason="cli-error"
    turn_silent_error
  else
  case "$subtype" in
    success) terminal_reason="completed" ;;
    # The codex branch above has already put the turn's own message
    # here; only claude's shape needs digging out at this point.
    *) terminal_reason="cli-error"
       [ -n "$error_msg" ] || error_msg="$(jq -r '(.errors // []) | join("; ")' <<<"$result_json")"
       if [ -n "$error_msg" ]; then
         provider_error_out="$(provider_error_json "$error_msg")"
         error_solution="$(provider_error_ending "$(jq -r .kind <<<"$provider_error_out")" "$tool" "$step_button")"
       else
         turn_silent_error
       fi ;;
  esac
  fi
}

# The tool wrote no result at all.
model_turn_no_result_outcome() {
  terminal_reason="cli-error"
  cost="0"; cost_measured="false"
  error_msg="$(tail -c 400 "$work_dir/err" 2>/dev/null | tr '\n' ' ')"
  # claude will not start on a ~/.claude.json that is not valid JSON, and
  # says how to fix it; pressing again fails the same way until someone has.
  if grep -q 'claude\.json' "$work_dir/err" 2>/dev/null; then
    [ -n "$error_msg" ] || error_msg="$tool produced no result JSON (exit $exit_code)"
    error_solution="fix or move that file on the serving host before $step_button can run"
  elif [ -z "$error_msg" ]; then
    turn_silent_error
  else
    # What the tool wrote last, sorted the way a failed turn's error is.
    provider_error_out="$(provider_error_json "$(tail -n 5 "$work_dir/err" 2>/dev/null)")"
    error_solution="$(provider_error_ending "$(jq -r .kind <<<"$provider_error_out")" "$tool" "$step_button")"
  fi
}
