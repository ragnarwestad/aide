#!/usr/bin/env bash
# run-spec/turn/side-turn.sh — a turn in a fresh session of its own beside
# the step's: implement's review and the verification of what it found
# (run-spec/turn/review.sh). Each may run on another model than the step,
# and on codex when the step is claude (--review-tool, --verify-tool).
#
# Everything the turn leaves in the step's globals is put back afterwards:
# the step's outcome, session, tokens, model id and limits stay the step's,
# so a review stopped by Codex's usage limit never reads as the step's own
# limit. What the turn itself came to is in $side_reason, $side_message
# and $side_cost.

# The command line for a fresh session of <tool> on <model>, into
# $side_argv. On the step's own tool it is the step's fresh command line
# with its session id dropped, the session renamed <name>, and the model
# swapped when one is given. On codex beside another tool it is a
# read-only `codex exec`: Claude's deny list does not reach Codex, and a
# review only reads. Fails when codex is asked for and cannot be found.
side_argv_for() {  # <tool> <model> <name>
  local arg skip="no" model_next="no" swapped="no"
  side_argv=()
  if [ "$1" = "$tool" ]; then
    for arg in "${fresh_argv[@]}"; do
      if [ "$skip" = "yes" ]; then skip="no"; continue; fi
      if [ "$model_next" = "yes" ]; then side_argv+=("${2:-$arg}"); model_next="no"; continue; fi
      case "$arg" in
        --session-id) skip="yes" ;;
        --name) side_argv+=(--name "$3"); skip="yes" ;;
        --model) side_argv+=(--model); model_next="yes"; swapped="yes" ;;
        *) side_argv+=("$arg") ;;
      esac
    done
    [ "$swapped" = "yes" ] || [ -z "$2" ] || side_argv+=(--model "$2")
    return 0
  fi
  [ "$1" = "codex" ] || return 1
  [ -n "$codex_bin" ] || codex_bin="$(find_bin "${AIDE_CODEX_BIN:-}" codex)"
  [ -n "$codex_bin" ] && [ -x "$codex_bin" ] || return 1
  side_argv=("$codex_bin" exec --json --sandbox read-only)
  [ -n "$2" ] && side_argv+=(--model "$2")
  return 0
}

# Run <prompt-file> through $side_argv as <tool>, and put the step's own
# globals back afterwards.
side_turn() {  # <tool> <prompt-file>
  local saved_tool="$tool" saved_session="$session_out" saved_subtype="$subtype" \
    saved_cost="$cost" saved_measured="$cost_measured" saved_reason="$terminal_reason" \
    saved_error="$error_msg" saved_limit="${provider_limit_out:-}" saved_capacity="${at_capacity_out:-}" \
    saved_tokens="${tokens_json:-}" saved_model_id="${model_id_out:-}" saved_exit="${exit_code:-0}"
  local -a saved_argv=("${argv[@]}")
  tool="$1"; argv=("${side_argv[@]}")
  # A session of its own: how full its window got is not the step's.
  context_use_skip="yes"
  run_model_turn "$2"
  context_use_skip=""
  side_reason="$terminal_reason"; side_message="$turn_message"; side_cost="${cost:-0}"
  tool="$saved_tool"; argv=("${saved_argv[@]}")
  session_out="$saved_session"; subtype="$saved_subtype"; cost="$saved_cost"; cost_measured="$saved_measured"
  terminal_reason="$saved_reason"; error_msg="$saved_error"; provider_limit_out="$saved_limit"
  at_capacity_out="$saved_capacity"; tokens_json="$saved_tokens"; model_id_out="$saved_model_id"; exit_code="$saved_exit"
}
