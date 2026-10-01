#!/usr/bin/env bash
# run-spec/turn/step-tests.sh — sourced by aide-run-spec after run-spec/record/status-line.sh.
#
# An `implement` that reported success ends on a green test run the
# runner made ITSELF, never on the session's word. The session is told
# to run the suite through aide-record-test-run and tick its row off
# that exit code, and a session that skipped it, ran a narrower command,
# or misread a red run still reported "completed" — the landing then
# met the red suite on the merge, with no step left to press (454,
# 2026-09-14). So the same two scripts the landing's gate calls
# (dashboard land-branch/test-gate.ts) run here, on the step's own
# result in its worktree: aide-resolve-test-cmd says which commands the
# change calls for, aide-record-test-run runs them and writes the
# record into the spec folder — committed with the step's own commit
# by run-spec/publish/publish.sh, so the record on the branch is the runner's,
# not the session's. Red ends the step `tests-red` with the failing
# lines as its detail; the phase is not recorded as run, and Implement
# is the button to press again. A project whose changes fall under no
# test command has nothing to run and passes as before.
#
# Red does not end the step at once: the failing lines go BACK to the
# same session (claude `--resume <session id>`, codex
# `exec resume <thread> -`, opencode `--session <id>`; the step's own
# transcript appended to), which fixes what it broke and runs the suite
# again — up to AIDE_TEST_FIX_ROUNDS more turns (2), each within what
# is left of the step's time limit. The record on the branch is always
# the runner's last run.
#
# An `archive` runs nothing here, merged or not: its landing runs the
# suite once on exactly what main is about to become, and a run here too
# was the same suite two and three times per archive (2026-09-19).
# The runner's own run of the tests, inside what is left of the step's
# time limit: the limit is the whole step's, not the session's alone. A
# run still going when it runs out is stopped (124), and the step ends
# on its time limit with the work committed, like a session that ran
# out. `child` is this run while it lasts, so Cancel stops it too.
# The run's progress (aide-record-test-run --progress-file) into the Log
# as it comes: every line written since the last call, stamped.
step_tests_progress_seen=0
stage_test_progress() {
  local file="$work_dir/step-test-progress" total
  [ -f "$file" ] || return 0
  total="$(wc -l < "$file" | tr -d ' ')"
  [ "$total" -gt "$step_tests_progress_seen" ] || return 0
  while IFS= read -r line; do stage "tests: $line"; done \
    < <(sed -n "$((step_tests_progress_seen + 1)),${total}p" "$file")
  step_tests_progress_seen="$total"
}

run_step_tests_within_time() {
  local deadline tests_pid
  deadline=$(( started_at + ${timeout_sec%.*} ))
  : > "$work_dir/step-test-progress"
  step_tests_progress_seen=0
  set -m
  # Four bun workers, not one per core: two steps' suites share the
  # machine with the board and each other, and at eight apiece the
  # git-backed tests ran out of time on load alone. pytest keeps one per
  # core: at four its suite took two and a half times as long.
  AIDE_TEST_WORKERS="${AIDE_TEST_WORKERS:-4}" \
  "$SCRIPT_DIR/aide-record-test-run" --project-dir "$project_wt" --specs-root "$specs_root_wt" \
    --folder "$step_tests_folder" "${step_test_args[@]}" \
    --progress-file "$work_dir/step-test-progress" \
    --result-file "$work_dir/step-test-run.json" > "$work_dir/step-test-run.log" 2>&1 &
  tests_pid=$!
  set +m
  child="$tests_pid"
  while kill -0 "$tests_pid" 2>/dev/null; do
    stage_test_progress
    if [ "$(date +%s)" -ge "$deadline" ]; then
      kill -TERM "-$tests_pid" 2>/dev/null || kill -TERM "$tests_pid" 2>/dev/null
      sleep 2
      kill -KILL "-$tests_pid" 2>/dev/null || true
      wait "$tests_pid" 2>/dev/null
      child=""
      return 124
    fi
    sleep 1
  done
  wait "$tests_pid"
  local rc=$?
  stage_test_progress
  # The whole output, kept beside the step's own run log: the Log shows
  # its progress, this file what the tests actually said.
  if [ -n "${stream_file:-}" ]; then
    cat "$work_dir/step-test-run.log" >> "${stream_file%.stream.jsonl}.tests.log" 2>/dev/null || true
  fi
  # What the suite left running goes with it (see run_model_turn).
  kill -TERM "-$tests_pid" 2>/dev/null || true
  child=""
  return "$rc"
}

# The full-suite row of the spec's own 4-status.md is the runner's: its
# run is the one that decides, so a green one ticks the row and names the
# command in the row's Notes. The session runs the tests covering its
# change and never the whole suite. Found by its task text, in whichever
# table carries it; a spec without the row is left as it is.
tick_full_suite_row() {   # $1 = what ran
  local tmp
  status_file_for "$step_tests_folder"
  [ -n "$status_file" ] || return 0
  tmp="$(mktemp)" || return 0
  awk -v note="$1" '
    /^\| *Run the full test suite *\|/ && !done {
      n = split($0, c, "|")
      gsub(/\|/, "\\|", note)
      if (n >= 5) { c[3] = " ✅ "; c[4] = " " note " "; line = c[1]; for (i = 2; i <= n; i++) line = line "|" c[i]; print line; done = 1; next }
    }
    { print }
  ' "$status_file" > "$tmp" || { rm -f "$tmp"; return 0; }
  mv "$tmp" "$status_file" || rm -f "$tmp"
}

step_tests_folder=""
if [ "$terminal_reason" = "completed" ]; then
  case "$command_name" in
    implement) step_tests_folder="$spec_label" ;;
  esac
fi
if [ -n "$step_tests_folder" ]; then
  # Compared with the default branch, so a change to Markdown files alone
  # is tested by the project's documentation check, not its whole suite
  # (aide-resolve-test-cmd --changed-from).
  step_tests_base="$(default_branch "$project_root")"
  git -C "$project_wt" rev-parse --verify --quiet "origin/$step_tests_base" >/dev/null && step_tests_base="origin/$step_tests_base"
  step_tests_resolved="$("$SCRIPT_DIR/aide-resolve-test-cmd" --project-dir "$project_wt" --changed-from "$step_tests_base" 2>"$work_dir/resolve-test-cmd.err" | tail -1)"
  if printf '%s' "$step_tests_resolved" | jq -e '.docsOnly == true' >/dev/null 2>&1; then
    stage "only Markdown files changed — running the documentation check, not the whole suite"
  fi
  if ! printf '%s' "$step_tests_resolved" | jq -e '.ok == true' >/dev/null 2>&1; then
    terminal_reason="tests-red"
    ok="false"
    suffix=" (stopped: tests-red)"
    error_msg="the step reported success, but the runner could not work out the project's test command — $(printf '%s' "$step_tests_resolved" | jq -r '.error // "no answer"' 2>/dev/null). Press $step_button again for this step."
  else
    step_test_args=()
    step_test_count=0
    while IFS= read -r step_test_cmd; do
      [ -n "$step_test_cmd" ] || continue
      step_test_args+=(--cmd "$step_test_cmd")
      step_test_count=$((step_test_count + 1))
    done <<EOF_CMDS
$(printf '%s' "$step_tests_resolved" | jq -r '.commands[]?' 2>/dev/null)
EOF_CMDS
    if [ "$step_test_count" -gt 0 ]; then
      step_fix_rounds="${AIDE_TEST_FIX_ROUNDS:-2}"
      step_fix_round=0
      step_cost_total="$cost"
      while :; do
        stage "running the project's tests on $command_name's result ($step_test_count command(s))"
        run_step_tests_within_time
        step_tests_rc=$?
        if [ "$step_tests_rc" -eq 0 ]; then
          stage "the project's tests are green"
          tick_full_suite_row "\`$(printf '%s' "$step_tests_resolved" | jq -r '.commands | join(" && ")')\` — the runner's own run"
          break
        fi
        if [ "$step_tests_rc" -eq 124 ]; then
          terminal_reason="timeout"
          ok="false"
          suffix=" (stopped: timeout)"
          error_msg="stopped at its own ${timeout_sec}s time limit for this step while the project's tests were running — the work is committed to the branch; press $step_button again to test it"
          break
        fi
        # The lines a reader looks for first — a runner's own failure
        # markers, never a bare "Error:" inside a line a PASSING test
        # echoed — then the tail, so a suite that prints nothing of
        # that shape still shows what it said last.
        step_tests_failing="$(grep -E '^\(fail\)|^FAILED|^ERROR' "$work_dir/step-test-run.log" 2>/dev/null | awk '!seen[$0]++' | head -8)"
        [ -n "$step_tests_failing" ] || step_tests_failing="$(tail -c 600 "$work_dir/step-test-run.log" 2>/dev/null)"
        # Another turn, or the end: the cap, a session the runner cannot
        # resume, and what the step has left of its time.
        step_time_left=$(( started_at + ${timeout_sec%.*} - $(date +%s) ))
        if [ "$step_fix_round" -ge "$step_fix_rounds" ] || [ -z "$session_out" ] \
           || [ "$step_time_left" -le 0 ]; then
          terminal_reason="tests-red"
          ok="false"
          suffix=" (stopped: tests-red)"
          error_msg="the step reported success, but the project's tests are red on its result — the run and its record are the runner's own, not the session's. Press $step_button again for this step.
$step_tests_failing"
          break
        fi
        step_fix_round=$((step_fix_round + 1))
        stage_error "the tests are red — handing them back to the session (round $step_fix_round of $step_fix_rounds)"
        # The failing tests, then ONE full run: the runner runs the whole
        # suite again after this turn anyway. "Until it is green" sent
        # 486's archive and 491's implement round and round the full
        # suite under the load of five jobs, rerunning for timing tests
        # that passed on their own, until both hit their time limit with
        # the change long done (2026-09-18).
        step_fix_how="Run the tests that failed, and the tests covering your fix, until they pass. Do not run the whole suite: the runner runs it itself after this turn, and its run is the one that counts. A failing test that has nothing to do with this change and passes on its own is load on the machine, not a fault: say so, and report done."
        if [ "$command_name" = "archive" ]; then
          step_fix_ask="Fix it — the merge with main, or what that merge broke. $step_fix_how Round $step_fix_round of $step_fix_rounds."
        else
          step_fix_ask="Fix it — your own tests and any existing test the change broke. $step_fix_how Then report done. Round $step_fix_round of $step_fix_rounds."
        fi
        printf '%s\n' "The project's test suite is red on what you delivered. The runner ran it itself; this is what failed:" "" "$step_tests_failing" "" \
          "$step_fix_ask" > "$work_dir/prompt-fix-$step_fix_round"
        # The same argv, resumed: the session the step's own turns ran in.
        resume_argv "$session_out"
        argv=("${resumed_argv[@]}")
        run_model_turn "$work_dir/prompt-fix-$step_fix_round"
        step_cost_total="$(jq -n --arg a "$step_cost_total" --arg b "$cost" '(($a|tonumber) + ($b|tonumber))')"
        cost="$step_cost_total"
        # A turn that did not end cleanly keeps its own verdict (timeout,
        # cli-error): nothing to test.
        [ "$terminal_reason" = "completed" ] || break
      done
    fi
    # What was seen green, for the landing: the tree (links left out, the
    # same hash the record carries) and the commands. A landing that is
    # about to test exactly this tree with exactly these commands has
    # nothing to learn from a run of its own.
    if [ "$terminal_reason" = "completed" ] && [ "$step_test_count" -gt 0 ] && \
       declare -f aide_tree_hash >/dev/null 2>&1; then
      tested_tree="$(aide_tree_hash "$project_wt" 2>/dev/null || echo "")"
      [ -n "$tested_tree" ] && tested_green_json="$(jq -cn --arg tree "$tested_tree" \
        --argjson resolved "$step_tests_resolved" '{tree:$tree, commands:$resolved.commands}')"
    fi
  fi
fi
