#!/usr/bin/env bash
# run-spec/turn/side-turn.sh — a turn in a fresh session of its own beside
# the step's: implement's review and the verification of what it found
# (run-spec/turn/review.sh). Each may run on another model than the step,
# on any supported AI (--review-tool, --verify-tool).
#
# Everything the turn leaves in the step's globals is put back afterwards:
# the step's outcome, session, tokens, model id and limits stay the step's,
# so a review stopped by Codex's usage limit never reads as the step's own
# limit. What the turn itself came to is in $side_reason, $side_message
# and $side_cost.

# The command line for a fresh session of <tool> on <model>, into
# $side_argv. Every command uses that AI's read-only mode and a fresh
# session. Fails when the chosen AI is not installed.
side_argv_for() {  # <tool> <model> <name>
  local side_tool="$1" side_model="$2" side_name="$3"
  side_argv=()
  case "$side_tool" in
    codex)
      [ -n "$codex_bin" ] || codex_bin="$(find_bin "${AIDE_CODEX_BIN:-}" codex)"
      [ -n "$codex_bin" ] && [ -x "$codex_bin" ] || return 1
      codex_safety_flags plan || return 1
      side_argv=("$codex_bin" exec --json "${safety_flags[@]}")
      ;;
    opencode)
      [ -n "$opencode_bin" ] || opencode_bin="$(find_bin "${AIDE_OPENCODE_BIN:-}" opencode)"
      [ -n "$opencode_bin" ] && [ -x "$opencode_bin" ] || return 1
      opencode_safety_flags plan || return 1
      side_argv=("$opencode_bin" run --format json "${safety_flags[@]}")
      ;;
    claude)
      [ -n "$claude_bin" ] || claude_bin="$(find_bin "${AIDE_CLAUDE_BIN:-}" claude)"
      [ -n "$claude_bin" ] && [ -x "$claude_bin" ] || return 1
      side_argv=("$claude_bin" -p --output-format stream-json --verbose --permission-mode plan)
      [ "$sandbox" = "no" ] || side_argv+=(--settings "$(sandbox_settings_json)")
      side_argv+=(--name "$side_name")
      ;;
    *) return 1 ;;
  esac
  [ -n "$side_model" ] && side_argv+=(--model "$side_model")
}

# Run <prompt-file> through $side_argv as <tool>, and put the step's own
# globals back afterwards.
side_turn() {  # <tool> <prompt-file> <claude-config-dir> <codex-home>
  local saved_tool="$tool" saved_session="$session_out" saved_subtype="$subtype" \
    saved_cost="$cost" saved_measured="$cost_measured" saved_reason="$terminal_reason" \
    saved_error="$error_msg" saved_limit="${provider_limit_out:-}" saved_capacity="${at_capacity_out:-}" \
    saved_provider_error="${provider_error_out:-}" saved_time_limit="${time_limit_json:-}" \
    saved_tokens="${tokens_json:-}" saved_model_id="${model_id_out:-}" saved_exit="${exit_code:-0}" \
    saved_claude_dir="${claude_config_dir:-}" saved_codex_home="${CODEX_HOME:-}" saved_opencode_config="${opencode_config:-}"
  local -a saved_argv=("${argv[@]}")
  tool="$1"; argv=("${side_argv[@]}"); claude_config_dir="$3"
  if [ -n "$4" ]; then export CODEX_HOME="$4"; else unset CODEX_HOME; fi
  # A session of its own: how full its window got is not the step's.
  context_use_skip="yes"
  run_model_turn "$2"
  context_use_skip=""
  side_reason="$terminal_reason"; side_message="$turn_message"; side_cost="${cost:-0}"; side_error="$error_msg"
  side_limit="${provider_limit_out:-}"; side_capacity="${at_capacity_out:-}"; side_provider_error="${provider_error_out:-}"
  tool="$saved_tool"; argv=("${saved_argv[@]}")
  session_out="$saved_session"; subtype="$saved_subtype"; cost="$saved_cost"; cost_measured="$saved_measured"
  terminal_reason="$saved_reason"; error_msg="$saved_error"; provider_limit_out="$saved_limit"
  at_capacity_out="$saved_capacity"; provider_error_out="$saved_provider_error"; time_limit_json="$saved_time_limit"
  tokens_json="$saved_tokens"; model_id_out="$saved_model_id"; exit_code="$saved_exit"
  claude_config_dir="$saved_claude_dir"
  opencode_config="$saved_opencode_config"
  if [ -n "$saved_codex_home" ]; then export CODEX_HOME="$saved_codex_home"; else unset CODEX_HOME; fi
}
