#!/usr/bin/env bash
# run-spec/turn/time-limit.sh — sourced before run-spec/turn/model-turn/index.sh.
#
# A step's time limit as its stop sentence says it: in minutes, the unit the
# Settings page sets it in ("40-minute"). A limit that is not whole minutes,
# a test's or a hand-written config's, is said in seconds ("90-second").
time_limit_words() {
  local sec="$1"
  if [ "$sec" -gt 0 ] && [ $((sec % 60)) -eq 0 ]; then
    echo "$((sec / 60))-minute"
  else
    echo "${sec}-second"
  fi
}

# The step's limit counts the AI's turns, not the runner's own runs of the
# project's tests: those wait on the host's load, not on the AI. Each such
# run has a limit of its own, AIDE_TEST_RUN_LIMIT_SEC (an hour unless set),
# and the time the runs took is added to the step's deadline.
test_run_limit_sec="${AIDE_TEST_RUN_LIMIT_SEC:-3600}"
step_tests_seconds=0
step_deadline() {
  echo $(( started_at + ${timeout_sec%.*} + step_tests_seconds ))
}
