#!/usr/bin/env bash
# run-spec/turn/side-turn.sh — a turn in a fresh session of its own beside
# the step's: implement's review and the verification of what it found
# (run-spec/turn/review.sh). Each may run on another model than the step,
# on any supported AI (--review-tool, --verify-tool).
#
# The step's complete result is retained as one value and put back afterwards:
# its outcome, session, tokens, model id and limits stay the step's,
# so a review stopped by Codex's usage limit never reads as the step's own
# limit. What the turn itself came to is in $side_reason, $side_message
# and $side_cost, and its tokens, whether its tool reports dollars, how
# long it took and where its bytes begin and end in the transcript are in
# $side_tokens, $side_cost_known, $side_measured, $side_seconds, $side_from
# and $side_to. `side_json` writes them as the result's record of the turn.

# The command line for a fresh session of <tool> on <model>, into
# $side_argv. Every command uses that AI's read-only mode and a fresh
# session. Fails when the chosen AI is not installed.
side_argv_for() {  # <tool> <model> <name> [<bin>]
  local side_tool="$1" side_model="$2" side_name="$3" own_bin="${4:-}" side_bin=""
  local saved_requested="${invocation_requested_id:-}" saved_resume="${invocation_resume_id:-}"
  side_argv=()
  case "$side_tool" in
    codex)
      side_bin="$own_bin"
      if [ -z "$side_bin" ]; then
        [ -n "$codex_bin" ] || codex_bin="$(find_bin "${AIDE_CODEX_BIN:-}" codex)"
        side_bin="$codex_bin"
      fi
      [ -n "$side_bin" ] && [ -x "$side_bin" ] || return 1
      ;;
    opencode)
      side_bin="$own_bin"
      if [ -z "$side_bin" ]; then
        [ -n "$opencode_bin" ] || opencode_bin="$(find_bin "${AIDE_OPENCODE_BIN:-}" opencode)"
        side_bin="$opencode_bin"
      fi
      [ -n "$side_bin" ] && [ -x "$side_bin" ] || return 1
      ;;
    claude|fake-claude)
      side_bin="$claude_bin"
      if [ "$side_tool" = "fake-claude" ]; then
        # The stand-in by name: without one the turn does not run, so a
        # turn that says it is scripted never reaches a model.
        side_bin="${AIDE_CLAUDE_BIN:-}"
        [ -n "$side_bin" ] || side_bin="$(aide_config_get AIDE_CLAUDE_BIN "$project_root")"
        [ -n "$side_bin" ] || return 1
        side_bin="$(find_bin "$side_bin" claude)"
      elif [ -n "$own_bin" ]; then
        side_bin="$own_bin"
      fi
      [ -n "$side_bin" ] || side_bin="$(find_bin "${AIDE_CLAUDE_BIN:-}" claude)"
      [ -n "$side_bin" ] && [ -x "$side_bin" ] || return 1
      [ "$side_tool" = "fake-claude" ] || [ -n "$own_bin" ] || claude_bin="$side_bin"
      ;;
    *) return 1 ;;
  esac
  invocation_build "$side_tool" "$side_bin" plan "$side_model" "" "" "" "$side_name" || return 1
  side_argv=("${invocation_argv[@]}")
  side_requested_id="$invocation_requested_id"; side_resume_id="$invocation_resume_id"
  invocation_requested_id="$saved_requested"; invocation_resume_id="$saved_resume"
}

# Run <prompt-file> through $side_argv as <tool>, and put the step's own
# globals back afterwards.
side_turn() {  # <tool> <prompt-file> <claude-config-dir> <codex-home>
  local saved_tool="$tool" main_result side_result \
    saved_claude_dir="${claude_config_dir:-}" saved_codex_home="${CODEX_HOME:-}" saved_opencode_config="${opencode_config:-}" \
    saved_requested="${invocation_requested_id:-}" saved_resume="${invocation_resume_id:-}"
  local -a saved_argv=("${argv[@]}")
  turn_result_capture main_result
  tool="$1"; argv=("${side_argv[@]}"); claude_config_dir="$3"
  invocation_requested_id="${side_requested_id:-}"; invocation_resume_id="${side_resume_id:-}"
  if [ -n "$4" ]; then export CODEX_HOME="$4"; else unset CODEX_HOME; fi
  # A session of its own: how full its window got is not the step's.
  context_use_skip="yes"
  side_from="$({ wc -c < "$transcript"; } 2>/dev/null | tr -d ' ')"; side_clock="$(date +%s)"
  run_model_turn "$2" side_result
  context_use_skip=""
  side_to="$({ wc -c < "$transcript"; } 2>/dev/null | tr -d ' ')"; side_seconds=$(( $(date +%s) - side_clock ))
  side_tokens="$(jq -c '.tokens // empty' <<<"$side_result")"
  side_cost_known="$(turn_result_field "$side_result" costKnown)"; side_measured="$(turn_result_field "$side_result" costMeasured)"
  side_reason="$(turn_result_field "$side_result" outcome)"; side_message="$(turn_result_field "$side_result" message)"
  side_cost="$(turn_result_field "$side_result" cost)"; side_error="$(turn_result_field "$side_result" error)"
  side_error_solution="$(turn_result_field "$side_result" errorSolution)"
  side_session="$(turn_result_field "$side_result" sessionId)"
  side_model_id="$(turn_result_field "$side_result" modelId)"
  side_limit="$(jq -c '.providerLimit // empty' <<<"$side_result")"
  side_capacity="$(turn_result_field "$side_result" atCapacity)"
  side_provider_error="$(jq -c '.providerError // empty' <<<"$side_result")"
  side_time_limit="$(jq -c '.timeLimit // empty' <<<"$side_result")"
  tool="$saved_tool"; argv=("${saved_argv[@]}")
  turn_result_apply "$main_result"
  claude_config_dir="$saved_claude_dir"
  opencode_config="$saved_opencode_config"
  invocation_requested_id="$saved_requested"; invocation_resume_id="$saved_resume"
  if [ -n "$saved_codex_home" ]; then export CODEX_HOME="$saved_codex_home"; else unset CODEX_HOME; fi
}

# The record of the side turn that just ran, as the result carries it: how it
# ended, on which tool, how long it took, where its bytes are in the
# transcript, and its dollars and tokens when it measured them.
side_json() {  # <tool>
  jq -cn --arg outcome "$side_reason" --arg tool "$1" --argjson seconds "${side_seconds:-0}" \
    --argjson from "${side_from:-0}" --argjson to "${side_to:-0}" \
    --argjson costKnown "${side_cost_known:-false}" --argjson measured "${side_measured:-false}" \
    --argjson cost "${side_cost:-0}" --argjson tokens "${side_tokens:-null}" \
    --arg sessionId "${side_session:-}" --arg modelId "${side_model_id:-}" \
    --arg error "${side_error:-}" --arg errorSolution "${side_error_solution:-}" \
    --arg atCapacity "${side_capacity:-}" \
    --argjson providerLimit "${side_limit:-null}" --argjson providerError "${side_provider_error:-null}" \
    --argjson timeLimit "${side_time_limit:-null}" \
    '{outcome:$outcome, tool:$tool, durationSec:$seconds, transcript:{from:$from, to:$to}}
     + (if $costKnown and $measured then {costUsd:$cost} else {} end)
     + (if $tokens == null then {} else {tokens:$tokens} end)
     + (if $sessionId == "" then {} else {sessionId:$sessionId} end)
     + (if $modelId == "" then {} else {modelId:$modelId} end)
     + (if $error == "" then {} else {error:$error} end)
     + (if $errorSolution == "" then {} else {errorSolution:$errorSolution} end)
     + (if $atCapacity == "" then {} else {atCapacity:$atCapacity} end)
     + (if $providerLimit == null then {} else {providerLimit:$providerLimit} end)
     + (if $providerError == null then {} else {providerError:$providerError} end)
     + (if $timeLimit == null then {} else {timeLimit:$timeLimit} end)'
}
