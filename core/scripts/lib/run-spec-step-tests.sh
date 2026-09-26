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
run_step_tests_within_time() {
  local deadline tests_pid
  deadline=$(( started_at + ${timeout_sec%.*} ))
  set -m
  "$SCRIPT_DIR/aide-record-test-run" --project-dir "$project_wt" --specs-root "$specs_root_wt" \
    --folder "$step_tests_folder" "${step_test_args[@]}" \
    --result-file "$work_dir/step-test-run.json" > "$work_dir/step-test-run.log" 2>&1 &
  tests_pid=$!
  set +m
  child="$tests_pid"
  while kill -0 "$tests_pid" 2>/dev/null; do
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
  # What the suite left running goes with it (see run_model_turn).
  kill -TERM "-$tests_pid" 2>/dev/null || true
  child=""
  return "$rc"
}

step_tests_folder=""
if [ "$terminal_reason" = "completed" ]; then
  case "$command_name" in
    implement) step_tests_folder="$spec_label" ;;
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
    # The session was told to run these same commands through
    # aide-record-test-run, and that script writes the hash of the tree
    # it ran against into the record. A green record for EXACTLY the
    # tree the step delivered, naming exactly the commands resolved
    # here, is a run of this result — running it again would cost the
    # suite's whole duration to learn nothing. Anything else — no
    # record, a record without a tree (written by hand), another tree
    # (the session changed something after the run), other commands,
    # red — and the runner runs.
    step_record="$specs_root_wt/$step_tests_folder/test-run.json"
    # Asked twice: before the runner's first run, and again after every
    # turn the session is handed red lines to fix — it may run the suite
    # once through aide-record-test-run, and
    # running it once more ourselves on the very tree it just recorded
    # green cost a whole suite for nothing (spec 480's archive ran it
    # four times, 2026-09-18).
    session_record_covers_tree() {
      [ -f "$step_record" ] && declare -f aide_tree_hash >/dev/null 2>&1 || return 1
      local tree
      tree="$(aide_tree_hash "$project_wt" 2>/dev/null || echo "")"
      [ -n "$tree" ] && jq -e --arg tree "$tree" --argjson resolved "$step_tests_resolved" '
           .exitCode == 0 and .tree == $tree
           and (((.commands // [{command: .command}]) | map(.command) | sort) == ($resolved.commands | sort))
         ' "$step_record" >/dev/null 2>&1
    }
    step_tests_spared="no"
    if session_record_covers_tree; then
      step_tests_spared="yes"
      echo "aide-run-spec: the session's own green run covers the delivered tree ($step_tests_folder/test-run.json) — not run again" >&2
    fi
    if [ "$step_test_count" -gt 0 ] && [ "$step_tests_spared" = "no" ]; then
      step_fix_rounds="${AIDE_TEST_FIX_ROUNDS:-2}"
      step_fix_round=0
      step_cost_total="$cost"
      while :; do
        echo "aide-run-spec: running the project's tests on $command_name's result ($step_test_count command(s))" >&2
        run_step_tests_within_time
        step_tests_rc=$?
        [ "$step_tests_rc" -ne 0 ] || break
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
        step_tests_failing="$(grep -E '^\(fail\)|^FAILED|^ERROR' "$work_dir/step-test-run.log" 2>/dev/null | head -8)"
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
        echo "aide-run-spec: the tests are red — handing them back to the session (round $step_fix_round of $step_fix_rounds)" >&2
        # The failing tests, then ONE full run: the runner runs the whole
        # suite again after this turn anyway. "Until it is green" sent
        # 486's archive and 491's implement round and round the full
        # suite under the load of five jobs, rerunning for timing tests
        # that passed on their own, until both hit their time limit with
        # the change long done (2026-09-18).
        step_fix_how="Run the tests that failed, and the tests covering your fix, until they pass. Then run the full suite at most once, through aide-record-test-run, in the foreground — never start a second run while one is going. A failing test that has nothing to do with this change and passes on its own is load on the machine, not a fault: do not run the suite again for it — say so, and report done. The runner runs the suite itself after this turn."
        if [ "$command_name" = "archive" ]; then
          step_fix_ask="Fix it — the merge with main, or what that merge broke. $step_fix_how Round $step_fix_round of $step_fix_rounds."
        else
          step_fix_ask="Fix it — your own tests and any existing test the change broke. $step_fix_how Tick the row if that full run is green, then report done. Round $step_fix_round of $step_fix_rounds."
        fi
        printf '%s\n' "The project's test suite is red on what you delivered. The runner ran it itself; this is what failed:" "" "$step_tests_failing" "" \
          "$step_fix_ask" > "$work_dir/prompt-fix-$step_fix_round"
        # The same argv, resumed: the dashboard's minted id becomes the
        # session to continue.
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
            --sandbox|--add-dir) step_argv_skip="yes" ;;
            exec) step_retry_argv+=(exec resume); step_resumes="yes" ;;
            *) step_retry_argv+=("$step_arg") ;;
          esac
        done
        if [ "$tool" = "codex" ]; then
          step_retry_argv+=("$session_out" -)
        elif [ "$tool" = "opencode" ]; then
          # `--session <id>`, not `--resume`: opencode's own spelling
          # (`opencode run --help`, 1.18.31). The subcommand stays `run`,
          # so nothing above rewrote it and nothing here has to.
          step_retry_argv+=(--session "$session_out")
        else
          [ "$step_resumes" = "yes" ] || step_retry_argv+=(--resume "$session_out")
        fi
        argv=("${step_retry_argv[@]}")
        run_model_turn "$work_dir/prompt-fix-$step_fix_round"
        step_cost_total="$(jq -n --arg a "$step_cost_total" --arg b "$cost" '(($a|tonumber) + ($b|tonumber))')"
        cost="$step_cost_total"
        # A turn that did not end cleanly keeps its own verdict (timeout,
        # cli-error): nothing to test.
        [ "$terminal_reason" = "completed" ] || break
        if session_record_covers_tree; then
          echo "aide-run-spec: the session's own green run after round $step_fix_round covers the delivered tree ($step_tests_folder/test-run.json) — not run again" >&2
          break
        fi
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
