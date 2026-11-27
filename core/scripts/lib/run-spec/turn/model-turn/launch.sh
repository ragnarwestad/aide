#!/usr/bin/env bash
# run-spec/turn/model-turn/launch.sh — what a model turn's process starts
# with: its environment and its command line. Called inside the subshell
# run_model_turn (model-turn/index.sh) starts the turn in, so what it
# exports reaches that turn alone, never the step's own test run.

# Exports the turn's environment and sets $launch_argv to the command it
# execs. Fails when srt's settings cannot be written.
turn_launch() {
  # opencode's read-only config ($opencode_config, setup/invocation.sh).
  [ -n "${opencode_config:-}" ] && export OPENCODE_CONFIG_CONTENT="$opencode_config"
  # The step's Claude account, for every Claude turn: the step's own, its
  # review and verification, and the fix turns. A Codex or OpenCode side
  # turn beside it is not given it.
  case "$tool" in codex|opencode) ;; *) [ -n "${claude_config_dir:-}" ] && export CLAUDE_CONFIG_DIR="$claude_config_dir" ;; esac
  # The tests the session runs itself keep to the same share as the runner's own run.
  local workers settings="$work_dir/srt-settings.json"
  workers="$(test_workers_now)"; [ -n "$workers" ] && export AIDE_TEST_WORKERS="$workers"
  launch_argv=("${argv[@]}")
  # A Codex or OpenCode turn starts inside srt, with its settings written
  # afresh for each turn, so none starts with what an earlier one wrote
  # (setup/srt.sh).
  case "$tool" in codex|opencode)
    srt_settings_json "$tool" "${turn_permission:-$permission_mode}" "$settings" \
      "$project_wt" ${invocation_add_dirs[@]+"${invocation_add_dirs[@]}"} > "$settings" || return 1
    launch_argv=("$srt_bin" --settings "$settings" -- "${argv[@]}") ;;
  esac
}
