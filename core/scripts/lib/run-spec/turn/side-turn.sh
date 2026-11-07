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
side_argv_for() {  # <tool> <model> <name> [<bin>]
  local side_tool="$1" side_model="$2" side_name="$3" own_bin="${4:-}" side_bin=""
  side_argv=()
  case "$side_tool" in
    codex)
      side_bin="$own_bin"
      if [ -z "$side_bin" ]; then
        [ -n "$codex_bin" ] || codex_bin="$(find_bin "${AIDE_CODEX_BIN:-}" codex)"
        side_bin="$codex_bin"
      fi
      [ -n "$side_bin" ] && [ -x "$side_bin" ] || return 1
      codex_safety_flags plan || return 1
      side_argv=("$side_bin" exec --json "${safety_flags[@]}")
      ;;
    opencode)
      side_bin="$own_bin"
      if [ -z "$side_bin" ]; then
        [ -n "$opencode_bin" ] || opencode_bin="$(find_bin "${AIDE_OPENCODE_BIN:-}" opencode)"
        side_bin="$opencode_bin"
      fi
      [ -n "$side_bin" ] && [ -x "$side_bin" ] || return 1
      opencode_safety_flags plan || return 1
      side_argv=("$side_bin" run --format json "${safety_flags[@]}")
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
      side_argv=("$side_bin" -p --output-format stream-json --verbose --permission-mode plan)
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
    saved_cost="$cost" saved_measured="$cost_measured" saved_known="$cost_known" saved_reason="$terminal_reason" \
    saved_error="$error_msg" saved_fix="${error_solution:-}" saved_log="${error_log:-}" saved_limit="${provider_limit_out:-}" saved_capacity="${at_capacity_out:-}" \
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
  session_out="$saved_session"; subtype="$saved_subtype"; cost="$saved_cost"; cost_measured="$saved_measured"; cost_known="$saved_known"
  terminal_reason="$saved_reason"; error_msg="$saved_error"; error_solution="$saved_fix"; error_log="$saved_log"; provider_limit_out="$saved_limit"
  at_capacity_out="$saved_capacity"; provider_error_out="$saved_provider_error"; time_limit_json="$saved_time_limit"
  tokens_json="$saved_tokens"; model_id_out="$saved_model_id"; exit_code="$saved_exit"
  claude_config_dir="$saved_claude_dir"
  opencode_config="$saved_opencode_config"
  if [ -n "$saved_codex_home" ]; then export CODEX_HOME="$saved_codex_home"; else unset CODEX_HOME; fi
}
