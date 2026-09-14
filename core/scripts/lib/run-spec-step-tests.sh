#!/usr/bin/env bash
# run-spec-step-tests.sh — sourced by aide-run-spec after run-spec-status-line.sh.
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
# by run-spec-publish.sh, so the record on the branch is the runner's,
# not the session's. Red ends the step `tests-red` with the failing
# lines as its detail; the phase is not recorded as run, and Implement
# is the button to press again. A project whose changes fall under no
# test command has nothing to run and passes as before.
#
# Red does not end the step at once: the failing lines go BACK to the
# same session (claude: `--resume <session id>`, the step's own
# transcript appended to), which fixes what it broke and runs the suite
# again — up to AIDE_TEST_FIX_ROUNDS more turns (2), each within what
# is left of the step's budget and time limit. Codex has no resume the
# runner drives, so a red run there ends the step at once. The record
# on the branch is always the runner's last run.
#
# An `archive` is the other step whose result no green run has seen:
# its pull merges main into the branch, and main has moved since
# implement's own green run — the one place a suite green at implement
# time turns red before the landing. So the same run, the same rounds,
# on the merged result, with the record written into the folder where
# the archive has just moved it. A pull that fast-forwarded brought the
# branch nothing new, and nothing is run.
step_tests_folder=""
if [ "$terminal_reason" = "completed" ]; then
  case "$command_name" in
    implement) step_tests_folder="$spec_label" ;;
    archive) [ "${base_merged_count:-0}" -gt 0 ] && step_tests_folder="archive/$spec_label" ;;
  esac
fi
if [ -n "$step_tests_folder" ]; then
  step_tests_resolved="$("$SCRIPT_DIR/aide-resolve-test-cmd" --project-dir "$project_wt" 2>"$work_dir/resolve-test-cmd.err" | tail -1)"
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
        echo "aide-run-spec: running the project's tests on $command_name's result ($step_test_count command(s))" >&2
        "$SCRIPT_DIR/aide-record-test-run" --project-dir "$project_wt" --specs-root "$specs_root_wt" \
          --folder "$step_tests_folder" "${step_test_args[@]}" \
          --result-file "$work_dir/step-test-run.json" > "$work_dir/step-test-run.log" 2>&1
        step_tests_rc=$?
        [ "$step_tests_rc" -ne 0 ] || break
        # The lines a reader looks for first — a runner's own failure
        # markers, never a bare "Error:" inside a line a PASSING test
        # echoed — then the tail, so a suite that prints nothing of
        # that shape still shows what it said last.
        step_tests_failing="$(grep -E '^\(fail\)|^FAILED|^ERROR' "$work_dir/step-test-run.log" 2>/dev/null | head -8)"
        [ -n "$step_tests_failing" ] || step_tests_failing="$(tail -c 600 "$work_dir/step-test-run.log" 2>/dev/null)"
        # Another turn, or the end: the cap, a session the runner cannot
        # resume, and what the step has left of its budget and its time.
        step_budget_left="$(jq -n --arg b "$budget_usd" --arg c "$step_cost_total" '(($b|tonumber) - ($c|tonumber)) | if . > 0 then . else 0 end')"
        step_time_left=$(( started_at + ${timeout_sec%.*} - $(date +%s) ))
        if [ "$step_fix_round" -ge "$step_fix_rounds" ] || [ -z "$session_out" ] \
           || [ "$step_budget_left" = "0" ] || [ "$step_time_left" -le 0 ]; then
          terminal_reason="tests-red"
          ok="false"
          suffix=" (stopped: tests-red)"
          error_msg="the step reported success, but the project's tests are red on its result — the run and its record are the runner's own, not the session's. Press $step_button again for this step.
$step_tests_failing"
          break
        fi
        step_fix_round=$((step_fix_round + 1))
        echo "aide-run-spec: the tests are red — handing them back to the session (round $step_fix_round of $step_fix_rounds)" >&2
        if [ "$command_name" = "archive" ]; then
          step_fix_ask="Fix it — the merge with main, or what that merge broke — and run the suite again through aide-record-test-run until it is green, then report done. Round $step_fix_round of $step_fix_rounds."
        else
          step_fix_ask="Fix it — your own tests and any existing test the change broke — and run the suite again through aide-record-test-run until it is green, tick the row, then report done. Round $step_fix_round of $step_fix_rounds."
        fi
        printf '%s\n' "The project's test suite is red on what you delivered. The runner ran it itself; this is what failed:" "" "$step_tests_failing" "" \
          "$step_fix_ask" > "$work_dir/prompt-fix-$step_fix_round"
        # The same argv, resumed: the dashboard's minted id becomes the
        # session to continue, and the budget is what is left of it.
        # Codex resumes through `codex exec resume <thread> -` (the
        # prompt on stdin, as before): the thread id is the one its
        # first turn named, and `resume` takes the bypass flag and the
        # model but neither `--sandbox` nor `--add-dir` (verified on
        # 0.154.0) — the thread keeps what it started with, so those
        # pairs are dropped rather than refused.
        step_retry_argv=()
        step_argv_skip="no"
        step_resumes="no"
        for step_arg in "${argv[@]}"; do
          if [ "$step_argv_skip" = "yes" ]; then step_argv_skip="no"; continue; fi
          case "$step_arg" in
            --session-id|--resume) step_retry_argv+=(--resume "$session_out"); step_resumes="yes"; step_argv_skip="yes" ;;
            --max-budget-usd) step_retry_argv+=(--max-budget-usd "$step_budget_left"); step_argv_skip="yes" ;;
            --sandbox|--add-dir) step_argv_skip="yes" ;;
            exec) step_retry_argv+=(exec resume); step_resumes="yes" ;;
            *) step_retry_argv+=("$step_arg") ;;
          esac
        done
        if [ "$tool" = "codex" ]; then
          step_retry_argv+=("$session_out" -)
        else
          [ "$step_resumes" = "yes" ] || step_retry_argv+=(--resume "$session_out")
        fi
        argv=("${step_retry_argv[@]}")
        run_model_turn "$work_dir/prompt-fix-$step_fix_round"
        step_cost_total="$(jq -n --arg a "$step_cost_total" --arg b "$cost" '(($a|tonumber) + ($b|tonumber))')"
        cost="$step_cost_total"
        # A turn that did not end cleanly keeps its own verdict (timeout,
        # budget, cli-error): nothing to test.
        [ "$terminal_reason" = "completed" ] || break
      done
    fi
  fi
fi
