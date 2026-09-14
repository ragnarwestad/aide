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
if [ "$command_name" = "implement" ] && [ "$terminal_reason" = "completed" ]; then
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
      echo "aide-run-spec: running the project's tests on implement's result ($step_test_count command(s))" >&2
      "$SCRIPT_DIR/aide-record-test-run" --project-dir "$project_wt" --specs-root "$specs_root_wt" \
        --folder "$spec_label" "${step_test_args[@]}" \
        --result-file "$work_dir/step-test-run.json" > "$work_dir/step-test-run.log" 2>&1
      step_tests_rc=$?
      if [ "$step_tests_rc" -ne 0 ]; then
        terminal_reason="tests-red"
        ok="false"
        suffix=" (stopped: tests-red)"
        # The lines a reader looks for first — a runner's own failure
        # markers — then the tail, so a suite that prints nothing of
        # that shape still shows what it said last.
        step_tests_failing="$(grep -E '^\(fail\)|^FAILED|^ERROR|Error:' "$work_dir/step-test-run.log" 2>/dev/null | head -8)"
        [ -n "$step_tests_failing" ] || step_tests_failing="$(tail -c 600 "$work_dir/step-test-run.log" 2>/dev/null)"
        error_msg="the step reported success, but the project's tests are red on its result — the run and its record are the runner's own, not the session's. Press $step_button again for this step.
$step_tests_failing"
      fi
    fi
  fi
fi
