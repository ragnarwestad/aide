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
# is left of the step's time limit, which the test runs do not use up. The record on the branch is always
# the runner's last run. Each red run's failing tests are read by name
# (lib/failing-tests.sh): a fix round is handed those, and a step
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
# The runner's own run of the tests, under its own limit
# (test_run_limit_sec, run-spec/turn/time-limit.sh), and the time it took
# added to the step's deadline. A run still going at its limit is stopped
# (124), and the step ends on that limit with the work committed, like a
# session that ran out. `child` is this run while it lasts, so Cancel
# stops it too.
# The run's progress (aide-record-test-run --progress-file) into the Log
# as it comes: every line written since the last call, stamped.
step_tests_progress_seen=0
step_test_active_log=""
preserve_step_test_log() {
  [ -n "${stream_file:-}" ] || return 0
  [ -n "$step_test_active_log" ] || return 0
  [ -f "$step_test_active_log" ] || return 0
  cat "$step_test_active_log" >> "${stream_file%.stream.jsonl}.tests.log" 2>/dev/null || true
  step_test_active_log=""
}

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
  local deadline tests_pid run_started
  run_started="$(date +%s)"
  deadline=$(( run_started + ${test_run_limit_sec%.*} ))
  : > "$work_dir/step-test-progress"
  step_tests_progress_seen=0
  # The recorder's own answer, read after the run (recorder_failure): a
  # file left by an earlier round must not speak for this one.
  rm -f "$work_dir/step-test-run.json"
  step_test_active_log="$work_dir/step-test-run.log"
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
      cleanup_owned_process "$child" terminate
      preserve_step_test_log
      step_tests_seconds=$(( step_tests_seconds + $(date +%s) - run_started ))
      return 124
    fi
    sleep 1
  done
  cleanup_owned_process "$child" reap
  local rc=$cleanup_exit_code
  step_tests_seconds=$(( step_tests_seconds + $(date +%s) - run_started ))
  stage_test_progress
  # The whole output, kept beside the step's own run log: the Log shows
  # its progress, this file what the tests actually said.
  preserve_step_test_log
  return "$rc"
}

# Run every still-red file once, alone, using the project's configured
# file command. The check stays inside one test run's limit and `child`
# points at it so Cancel stops it too. $1 is failing_tests JSON, $2 output.
run_red_files_again() {
  local named="$1" out="$2" cmd deadline file pid rc log rows interrupted
  cmd="$(printf '%s' "$step_tests_resolved" | jq -r '.filesCommand // empty')"
  rows="$work_dir/red-files-again.ndjson"
  : > "$rows"
  if [ -z "$cmd" ]; then
    stage "no AIDE_TEST_FILES_CMD — the red test files are not run again"
    printf '[]\n' > "$out"
    return 0
  fi
  deadline=$(( $(date +%s) + ${test_run_limit_sec%.*} ))
  while IFS= read -r file; do
    [ "$(date +%s)" -lt "$deadline" ] || { stage "no time left to run the remaining red test files again"; break; }
    log="$work_dir/red-again-$(wc -l < "$rows" | tr -d ' ').log"
    step_test_active_log="$log"
    interrupted="false"
    stage "running $file again alone"
    set -m
    ( cd "$project_wt" && export AIDE_TEST_WORKERS="${AIDE_TEST_WORKERS:-1}" && \
      exec bash -c "$cmd \"\$@\"" aide-test-files "$file" ) > "$log" 2>&1 &
    pid=$!
    set +m
    child="$pid"
    while kill -0 "$pid" 2>/dev/null; do
      if [ "$(date +%s)" -ge "$deadline" ]; then
        interrupted="true"
        cleanup_owned_process "$child" terminate
        break
      fi
      sleep 1
    done
    if [ -n "$child" ]; then
      cleanup_owned_process "$child" reap
    fi
    rc=$cleanup_exit_code
    [ "$interrupted" = "true" ] && rc=1
    if [ -n "${stream_file:-}" ]; then
      printf '\n--- %s, run again alone:\n' "$file" >> "${stream_file%.stream.jsonl}.tests.log"
    fi
    preserve_step_test_log
    results="$(test_results "$log")"
    jq -cn --arg file "$file" --argjson passed "$([ "$rc" -eq 0 ] && echo true || echo false)" \
      --argjson results "$results" '{file:$file, passed:$passed} + $results' >> "$rows"
    stage "$file $([ "$rc" -eq 0 ] && echo passed || echo failed) when run again alone"
  done < <(failing_tests_files "$named")
  jq -s '.' "$rows" > "$out"
}

# The recorder's own failure, as one JSON object, when the run's result
# says no test ran: aide-record-test-run refused (`ok:false`), or ended
# without a result at all. Kind `spec-folder-missing` (with `folder`) for
# a spec folder it could not find on the spec's branch, otherwise
# `recorder-failed` (with `exitCode`, and `error`: the recorder's own
# refusal, or that it wrote no readable result). Prints nothing when the recorder
# recorded a run, red or green: then the tests' own exit code speaks.
recorder_failure() {   # $1 = the recorder's result file, $2 = its log, $3 = its exit code
  local result="$1" log="$2" rc="$3" error
  if [ -s "$result" ] && jq -e '.ok == true' "$result" >/dev/null 2>&1; then
    return 0
  fi
  error="$(jq -r '.error // empty' "$result" 2>/dev/null)"
  [ -n "$error" ] || error="$(grep -v '^[[:space:]]*$' "$log" 2>/dev/null | tail -1)"
  case "$error" in
    "no such spec folder: "*)
      jq -cn --arg f "${error#no such spec folder: }" '{kind:"spec-folder-missing", folder:$f}' ;;
    *)
      error="$(jq -r '.error // empty' "$result" 2>/dev/null)"
      [ -n "$error" ] || error="the test recorder did not write a readable result (exit code $rc)"
      jq -cn --argjson rc "$rc" --arg e "$error" '{kind:"recorder-failed", exitCode:$rc, error:$e}' ;;
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
if [ "$terminal_reason" = "completed" ] && [ "$STEP_RUNS_TESTS" = "true" ]; then
  step_tests_folder="$spec_label"
fi
if [ -n "$step_tests_folder" ]; then
  # Compared with the default branch, so a change to Markdown files alone
  # is tested by the project's documentation check, not its whole suite
  # (aide-resolve-test-cmd --changed-from) — unless the spec's last landing
  # failed tests on the merge (setup/invocation.sh): those are what this
  # step is to make pass, and only the whole suite runs them.
  if [ "${landing_failed_tests:-}" = "yes" ]; then
    stage "the last landing failed tests on the merge — running the whole suite, whatever the change touched"
    step_tests_resolved="$("$SCRIPT_DIR/aide-resolve-test-cmd" --project-dir "$project_wt" 2>"$work_dir/resolve-test-cmd.err" | tail -1)"
  else
    step_tests_base="$(default_ref "$project_wt" "$project_root")"
    step_tests_resolved="$("$SCRIPT_DIR/aide-resolve-test-cmd" --project-dir "$project_wt" --changed-from "$step_tests_base" 2>"$work_dir/resolve-test-cmd.err" | tail -1)"
  fi
  if printf '%s' "$step_tests_resolved" | jq -e '.docsOnly == true' >/dev/null 2>&1; then
    stage "only Markdown files changed — running the documentation check, not the whole suite"
  fi
  if ! printf '%s' "$step_tests_resolved" | jq -e '.ok == true' >/dev/null 2>&1; then
    tests_not_started_json="$(jq -cn '{kind:"test-command-unresolved"}')"
    stop_step tests-not-started "the step reported success, but no test ran because the runner could not work out the project's test command" \
      "fix AIDE_TEST_CMD in the project's .aide/project.yaml, then press $step_button again"
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
      step_tokens_total="${tokens_json:-}"
      # The tests each red run named (lib/failing-tests.sh).
      step_tests_runs=0
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
          stop_step timeout "stopped when one run of the project's tests reached its own $(time_limit_words "$test_run_limit_sec") limit; the work is committed to the branch" \
            "press $step_button again to test it"
          time_limit_json="$(jq -cn --argjson s "$test_run_limit_sec" '{seconds:$s, during:"tests"}')"
          break
        fi
        # The recorder did not run the tests: no session can fix that by
        # changing the code, so it ends the step at once, never as red tests.
        step_tests_unrun="$(recorder_failure "$work_dir/step-test-run.json" "$work_dir/step-test-run.log" "$step_tests_rc")"
        if [ -n "$step_tests_unrun" ]; then
          tests_not_started_json="$step_tests_unrun"
          if [ "$(jq -r '.kind' <<<"$step_tests_unrun")" = "spec-folder-missing" ]; then
            stop_step tests-not-started "the step reported success, but the project's tests were not run — $(aide_spec_reference "$project_name" "$(jq -r '.folder' <<<"$step_tests_unrun")") was not found on the spec's branch, where the runner records the test run" \
              "press $step_button again for this step once the folder is back in place"
          else
            stop_step tests-not-started "the step reported success, but the project's tests were not run — the test recorder did not write a readable result (exit code $(jq -r '.exitCode' <<<"$step_tests_unrun"))" \
              "press $step_button again for this step once the recorder is working"
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
        # The recorder read them from the run's output, as it does for the landing.
        jq -c '.failingTests // {tests:[], files:[], errors:[]}' "$work_dir/step-test-run.json" > "$step_tests_named" 2>/dev/null \
          || echo '{"tests":[],"files":[],"errors":[]}' > "$step_tests_named"
        # The suite never started — its server could not start (run-spec/turn/test-start.sh).
        # No session can free a port or start a machine's service, so this
        # ends the step at once, with the cause and, for a port, who holds it.
        step_tests_start="$(test_start_failure "$work_dir/step-test-run.log")"
        if [ -n "$step_tests_start" ]; then
          step_tests_start_line="$(printf '%s' "$step_tests_start" | jq -r '.line')"
          step_tests_failed_command_index="$(awk -v target="$step_tests_start_line" '
            /^--- aide test command: / { sub(/^--- aide test command: /, ""); command = $0; next }
            $0 == target { print command; exit }
          ' "$work_dir/step-test-run.log")"
          step_tests_failed_command="$(jq -r --argjson index "${step_tests_failed_command_index:-0}" \
            'if $index > 0 then .commands[$index - 1].command // empty else .command // empty end' \
            "$work_dir/step-test-run.json")"
          step_tests_port="$(printf '%s' "$step_tests_start" | jq -r '.port // empty')"
          step_tests_holder=""
          [ -n "$step_tests_port" ] && step_tests_holder="$(port_holder "$step_tests_port")"
          tests_not_started_json="$(jq -c --arg command "$step_tests_failed_command" --argjson holder "${step_tests_holder:-null}" \
            '. + {command:$command} + (if $holder == null then {} else {holder:$holder} end)' <<<"$step_tests_start")"
          case "$(printf '%s' "$step_tests_start" | jq -r '.kind')" in
            docker-down)
              stop_step tests-not-started "the step reported success, but the project's tests could not start because Docker is not running on this machine.
$step_tests_start_line" "start Docker on this machine, then press $step_button again" ;;
            connection-refused)
              stop_step tests-not-started "the step reported success, but the project's tests could not start because nothing answered on port $step_tests_port on this machine.
$step_tests_start_line" "start the service that listens on port $step_tests_port, then press $step_button again" ;;
            *)
              stop_step tests-not-started "the step reported success, but the project's tests stopped when the server needed by ${step_tests_failed_command:-the test command} could not start.
$step_tests_start_line" "press $step_button again once that server can start" ;;
          esac
          [ -n "$step_tests_holder" ] && error_msg="$error_msg
port $step_tests_port is held by $(printf '%s' "$step_tests_holder" | jq -r '"\(.command // "a process") (pid \(.pid))" + (if .spec then ", spec \(.spec)" else "" end)')"
          # What the server printed and who holds the port: the sentence's lines after its first.
          error_log="${error_msg#*$'\n'}"
          break
        fi
        # Another turn, or the end: the cap, a session the runner cannot
        # resume, and what the step has left of its time.
        step_time_left=$(( $(step_deadline) - $(date +%s) ))
        if [ "$step_fix_round" -ge "$step_fix_rounds" ] || [ -z "$session_out" ] \
           || [ "$step_time_left" -le 0 ]; then
          stop_step tests-red "the step reported success, but the project's tests are red on its result — the run and its record are the runner's own, not the session's.
$step_tests_failing" "if the fault is in the code, press $step_button again; if something on the machine stopped the tests, such as a port in use or a service that is down, fix that first"
          error_log="$step_tests_failing"
          # No session turn occurs between the last suite run and this
          # isolated check of every red file.
          run_red_files_again "$step_tests_named" "$work_dir/red-again.json"
          tests_red_json="$(failing_tests_summary "$step_tests_named" "$work_dir/red-again.json")"
          tests_red_json="$(jq -c --argjson attempts "$step_tests_runs" '. + {attempts:$attempts}' <<<"$tests_red_json")"
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
        step_fix_ask="Fix it — your own tests and any existing test the change broke. $step_fix_how Then report done. Round $step_fix_round of $step_fix_rounds."
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
        run_model_turn "$work_dir/prompt-fix-$step_fix_round" step_fix_result
        step_cost_total="$(jq -n --arg a "$step_cost_total" --arg b "$cost" '(($a|tonumber) + ($b|tonumber))')"
        cost="$step_cost_total"
        sides_priced_again
        step_tokens_total="$(turn_tokens_add "$step_tokens_total" "${tokens_json:-}")"
        tokens_json="$step_tokens_total"
        # A turn that did not end cleanly keeps its own verdict (timeout,
        # cli-error): nothing to test.
        [ "$terminal_reason" = "completed" ] || break
      done
    fi
    # What was seen green, for the landing: the tree (links left out, the
    # same hash the record carries) and the commands. A landing that is
    # about to test exactly this tree with exactly these commands has
    # nothing to learn from a run of its own.
    if [ "$terminal_reason" = "completed" ] && [ "$step_test_count" -gt 0 ]; then
      tested_tree="$(aide_tree_hash "$project_wt" 2>/dev/null || echo "")"
      [ -n "$tested_tree" ] && tested_green_json="$(jq -cn --arg tree "$tested_tree" \
        --argjson resolved "$step_tests_resolved" '{tree:$tree, commands:$resolved.commands}')"
    fi
  fi
fi

# `ok` was decided on an implement's first turn. A later turn of the same
# step (the review's fix, a red suite's fix) that did not end completed is
# the step's outcome, so the step is not ok.
if [ "$command_name" = "implement" ] && [ "$ok" = "true" ] && [ "$terminal_reason" != "completed" ]; then
  ok="false"
fi
