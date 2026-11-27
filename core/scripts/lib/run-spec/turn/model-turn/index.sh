#!/usr/bin/env bash
# run-spec/turn/model-turn/index.sh — sourced by aide-run-spec before run-spec/turn/spec-paths.sh.
#
# The model's one turn, and the reading of what came back, for claude,
# codex and opencode alike. A function, defined here and called from
# run-spec/turn/spec-paths.sh (the step's own turn and the analysis-session
# retry), run-spec/turn/review.sh (the review and its fix turn) and
# run-spec/turn/step-tests.sh (a fix turn after red tests).

# Two token objects summed key by key, or nothing when either is missing: a
# token figure is measured or absent, so a sum with an unmeasured turn in it
# is not one.
turn_tokens_add() {  # <tokens-json> <tokens-json>
  jq -cn --argjson a "${1:-null}" --argjson b "${2:-null}" '
    if $a == null or $b == null then empty
    else (reduce ("input", "output", "cacheRead", "cacheCreation") as $k ({}; .[$k] = ($a[$k] + $b[$k])))
      | . + {total: (.input + .output + .cacheRead + .cacheCreation)}
    end' 2>/dev/null
}

# One turn of the model: run `argv` on the prompt in $1, wait it out under
# the step's deadline, and read the result back into the step's own
# globals ($terminal_reason, $error_msg, $cost, $session_out, ...). A
# function so run-spec/turn/step-tests.sh can ask for another turn — the same
# session resumed with the red suite's output — without a second copy of
# any of this. The transcript is appended to, so every turn of one step
# is in the one stream the dashboard shows.
run_model_turn() {  # <prompt-file> [<result-variable>]
  local result_name="${2:-turn_result}"
  # The transcript's size says where this turn's output begins: the dashboard
  # cuts the transcript there to put Aide's own lines between the turns.
  local turn_at resume_part="$aide_part" turn_from result_json
  turn_at="$({ wc -c < "$transcript"; } 2>/dev/null | tr -d ' ')"
  # The Aide part this turn interrupts ends here, and picks up again
  # after it — except preparing, which a turn always ends.
  aide_part_close
  stage "model turn started (transcript at byte ${turn_at:-0})"
  model_turn_launch "$1"
  model_turn_wait
  model_turn_reset_reads
  model_turn_read
  model_turn_record_totals
  model_turn_outcome
  # A failed tool's own words are what the board shows behind its sentence. A
  # tool that gave no reason has none: the runner's line saying so is not kept.
  if [ "$terminal_reason" = "cli-error" ] && [ "$(jq -r '.kind // empty' <<<"${provider_error_out:-null}" 2>/dev/null)" != "silent" ]; then
    error_log="$error_msg"
  fi
  [ -n "$resume_part" ] && [ "$resume_part" != "preparing" ] && aide_part_open "$resume_part"
  turn_to="$({ wc -c < "$transcript"; } 2>/dev/null | tr -d ' ')"
  turn_result_capture "$result_name"
  return 0
}

# Start the model on the prompt in $1, in the background, as its own
# process group; sets $child.
model_turn_launch() {
  # `set -m` puts the child in its OWN process group, so the deadline can
  # take down claude's children too — a kill that only reaches the parent
  # is not a bound. No pipeline here: with one, $! is the last command and
  # the group id would be someone else's.
  set -m
  # cd into the project's WORKTREE first. A skill resolves the project from
  # its working directory, so inheriting the caller's cwd (a server's, say)
  # makes the run analyse the wrong repository — measured on the first
  # real job, 2026-08-16, which cost $0.45 to discover. The
  # directory is the throwaway checkout, which is the tree this run will
  # commit from. `exec` keeps the pid, so $! is still the process group we
  # later signal.
  # The turn's environment and command line are set in the subshell alone
  # (model-turn/launch.sh), so the step's own test run never sees them.
  # ENABLE_CLAUDEAI_MCP_SERVERS=false keeps the claude.ai account's own
  # connectors (Gmail, Slack, Drive, Calendar, Docs) out of the session: claude
  # loads them into every session, `-p` too, and no step needs them. `--chrome`
  # and a project's own MCP servers are left as they are (verified 2.1.310).
  ( cd "$project_wt" || exit
    turn_launch || exit 126
    AIDE_HEADLESS=1 ENABLE_CLAUDEAI_MCP_SERVERS=false exec "${launch_argv[@]}" ) < "$1" >> "$transcript" 2>> "$work_dir/err" &
  child=$!
  set +m
}

# Wait the turn out under the step's deadline; sets $stopped, $exit_code
# and $duration.
model_turn_wait() {
  # The model's step marks go into the run log as they are written, each with the
  # run's clock (run-spec/turn/model-marks.sh).
  model_marks_begin "${turn_at:-0}"
  stopped=""
  deadline="$(step_deadline)"
  while kill -0 "$child" 2>/dev/null; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      stopped="timeout"
      break
    fi
    model_marks_record
    sleep 0.2
  done
  if [ -n "$stopped" ]; then
    cleanup_owned_process "$child" terminate
  else
    cleanup_owned_process "$child" reap
  fi
  exit_code=$cleanup_exit_code
  model_marks_record final
  sandbox_restore_git_links
  duration=$(( $(date +%s) - started_at ))
}
