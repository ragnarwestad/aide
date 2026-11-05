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
# the runner's last run. Each red run's failing tests are read by name
# (run-spec/turn/failing-tests.sh): a fix round is handed those, and a step
# still red carries them in the result's `testsRed`, with whether they lie
# in files the change touched and whether the runs failed different ones.
#
# A run whose tests never started — the server they need could not
# start (run-spec/turn/test-start.sh) — ends `tests-not-started` at once,
# with the cause in the result's `testsNotStarted`: a session cannot free
# a port another process holds, so no turn is spent on it. The same
# ending, at once, for a run the recorder itself did not make — it
# refused (the spec's folder not found on the branch) or ended without a
# result: the cause is `spec-folder-missing` or `recorder-failed`, read
# from the recorder's result, never from its exit code alone.
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
  # The recorder's own answer, read after the run (recorder_failure): a
  # file left by an earlier round must not speak for this one.
  rm -f "$work_dir/step-test-run.json"
  set -m
  # The host's cores divided among the steps and landings running now
  # (run-spec/turn/test-workers.sh): taken as the run starts, since the
  # session before it can take most of the step's time limit. A runner
  # started by hand has no board to share with, and keeps four.
  ( workers="$(test_workers_now)"
    export AIDE_TEST_WORKERS="${workers:-${AIDE_TEST_WORKERS:-4}}"
    exec "$SCRIPT_DIR/aide-record-test-run" --project-dir "$project_wt" --specs-root "$specs_root_wt" \
      --folder "$step_tests_folder" "${step_test_args[@]}" \
      --progress-file "$work_dir/step-test-progress" \
      --result-file "$work_dir/step-test-run.json" ) > "$work_dir/step-test-run.log" 2>&1 &
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

# The recorder's own failure, as one JSON object, when the run's result
# says no test ran: aide-record-test-run refused (`ok:false`), or ended
# without a result at all. Kind `spec-folder-missing` (with `folder`) for
# a spec folder it could not find on the spec's branch, otherwise
# `recorder-failed` (with `error`). Prints nothing when the recorder
# recorded a run, red or green: then the tests' own exit code speaks.
recorder_failure() {   # $1 = the recorder's result file, $2 = its log, $3 = its exit code
  local result="$1" log="$2" rc="$3" error
  if [ -s "$result" ] && jq -e '.ok == true' "$result" >/dev/null 2>&1; then
    return 0
  fi
  error="$(jq -r '.error // empty' "$result" 2>/dev/null)"
  [ -n "$error" ] || error="$(grep -v '^[[:space:]]*$' "$log" 2>/dev/null | tail -1)"
  [ -n "$error" ] || error="it ended with exit code $rc and no result"
  case "$error" in
    "no such spec folder: "*)
      jq -cn --arg f "${error#no such spec folder: }" '{kind:"spec-folder-missing", folder:$f}' ;;
    *)
      jq -cn --arg e "$error" '{kind:"recorder-failed", error:$e}' ;;
  esac
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
      # The tests each red run named (run-spec/turn/failing-tests.sh), and
      # whether a later run failed one an earlier run did not.
      step_tests_runs=0
      step_tests_varied=false
      # The lines of each task a monorepo runner's summary names as failed
      # that say error or fail, without their colour codes, at most eight.
      failed_task_lines() {
        local log="$1" task
        sed -n 's/^Failed: *\([^ ]*\)#\([^ ]*\) *$/\1:\2:/p' "$log" 2>/dev/null | while IFS= read -r task; do
          grep -F -- "$task" "$log" | grep -iE 'error|fail'
        done | sed $'s/\033\\[[0-9;]*m//g' | awk '!seen[$0]++' | head -8
      }
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
          error_msg="stopped at its own $(time_limit_words "$timeout_sec") time limit for this step while the project's tests were running — the work is committed to the branch; press $step_button again to test it"
          time_limit_json="$(jq -cn --argjson s "$timeout_sec" '{seconds:$s, during:"tests"}')"
          break
        fi
        # The recorder did not run the tests: no session can fix that by
        # changing the code, so it ends the step at once, never as red tests.
        step_tests_unrun="$(recorder_failure "$work_dir/step-test-run.json" "$work_dir/step-test-run.log" "$step_tests_rc")"
        if [ -n "$step_tests_unrun" ]; then
          tests_not_started_json="$step_tests_unrun"
          terminal_reason="tests-not-started"
          ok="false"
          suffix=" (stopped: tests-not-started)"
          if [ "$(jq -r '.kind' <<<"$step_tests_unrun")" = "spec-folder-missing" ]; then
            error_msg="the step reported success, but the project's tests were not run — the spec's folder $(jq -r '.folder' <<<"$step_tests_unrun") was not found on the spec's branch, where the runner records the test run. Press $step_button again for this step once the folder is back in place."
          else
            error_msg="the step reported success, but the project's tests were not run — the runner's test recorder failed: $(jq -r '.error' <<<"$step_tests_unrun"). Press $step_button again for this step once that is put right."
          fi
          break
        fi
        # The lines a reader looks for first — a runner's own failure
        # markers, never a bare "Error:" inside a line a PASSING test
        # echoed — then the tail, so a suite that prints nothing of
        # that shape still shows what it said last.
        step_tests_failing="$(grep -E '^\(fail\)|^FAILED|^ERROR' "$work_dir/step-test-run.log" 2>/dev/null | awk '!seen[$0]++' | head -8)"
        # A monorepo runner (turbo) ends on a summary naming the failed
        # package task, "Failed:    @x/email#test"; the cause is in that
        # task's own lines further up, each prefixed "@x/email:test:".
        [ -n "$step_tests_failing" ] || step_tests_failing="$(failed_task_lines "$work_dir/step-test-run.log")"
        [ -n "$step_tests_failing" ] || step_tests_failing="$(log_tail "$work_dir/step-test-run.log" 600)"
        step_tests_runs=$((step_tests_runs + 1))
        step_tests_named="$work_dir/failing-tests-$step_tests_runs.json"
        failing_tests "$work_dir/step-test-run.log" > "$step_tests_named"
        if [ "$step_tests_runs" -gt 1 ] && \
           failing_tests_varied "$work_dir/failing-tests-$((step_tests_runs - 1)).json" "$step_tests_named"; then
          step_tests_varied=true
        fi
        # The suite never started — its server could not start (run-spec/turn/test-start.sh).
        # No session can free a port or start a machine's service, so this
        # ends the step at once, with the cause and, for a port, who holds it.
        step_tests_start="$(test_start_failure "$work_dir/step-test-run.log")"
        if [ -n "$step_tests_start" ]; then
          step_tests_port="$(printf '%s' "$step_tests_start" | jq -r '.port // empty')"
          step_tests_holder=""
          [ -n "$step_tests_port" ] && step_tests_holder="$(port_holder "$step_tests_port")"
          tests_not_started_json="$(jq -c --argjson holder "${step_tests_holder:-null}" \
            'del(.line) + (if $holder == null then {} else {holder:$holder} end)' <<<"$step_tests_start")"
          terminal_reason="tests-not-started"
          ok="false"
          suffix=" (stopped: tests-not-started)"
          error_msg="the step reported success, but the project's tests did not start — the server the tests need could not start, so no test ran. Press $step_button again for this step once that is put right.
$(printf '%s' "$step_tests_start" | jq -r '.line')"
          [ -n "$step_tests_holder" ] && error_msg="$error_msg
port $step_tests_port is held by $(printf '%s' "$step_tests_holder" | jq -r '"\(.command // "a process") (pid \(.pid))" + (if .spec then ", spec \(.spec)" else "" end)')"
          break
        fi
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
          # The tests by name, for the board's sentence: whether any is in a
          # file the change touched, and whether the runs failed different ones.
          failing_tests_changed_files "$project_wt" "$step_tests_base" > "$work_dir/changed-files"
          tests_red_json="$(failing_tests_summary "$step_tests_named" "$work_dir/changed-files" "$step_tests_varied")"
          break
        fi
        step_fix_round=$((step_fix_round + 1))
        stage_error "the tests are red — handing them back to the session (round $step_fix_round of $step_fix_rounds)"
        # The failing tests, then ONE full run: the runner runs the whole
        # suite again after this turn anyway. "Until it is green" sent
        # an archive and an implement round and round the full
        # suite under the load of five jobs, rerunning for timing tests
        # that passed on their own, until both hit their time limit with
        # the change long done (2026-09-18).
        step_fix_how="Run the tests that failed, and the tests covering your fix, until they pass. Do not run the whole suite: the runner runs it itself after this turn, and its run is the one that counts. A failing test that has nothing to do with this change and passes on its own is load on the machine, not a fault: say so, and report done."
        if [ "$command_name" = "archive" ]; then
          step_fix_ask="Fix it — the merge with main, or what that merge broke. $step_fix_how Round $step_fix_round of $step_fix_rounds."
        else
          step_fix_ask="Fix it — your own tests and any existing test the change broke. $step_fix_how Then report done. Round $step_fix_round of $step_fix_rounds."
        fi
        # The failing tests by name when the output named them; the lines
        # that say why go with them only when no name carries a file (a
        # turbo task, a bare bun test), since the name alone says too little.
        step_fix_what="$step_tests_failing"
        if jq -e '.tests | length > 0' "$step_tests_named" >/dev/null 2>&1; then
          step_fix_what="$(failing_tests_list "$step_tests_named")"
          jq -e 'any(.files[]; . != "")' "$step_tests_named" >/dev/null 2>&1 || step_fix_what="$step_fix_what

$step_tests_failing"
        fi
        printf '%s\n' "The project's test suite is red on what you delivered. The runner ran it itself; this is what failed:" "" "$step_fix_what" "" \
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
