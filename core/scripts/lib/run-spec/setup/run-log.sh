#!/usr/bin/env bash
# run-spec/setup/run-log.sh — the run log's two fixed lines, written here
# and nowhere else in the runner. Sourced by aide-run-spec before any part.
#
# The dashboard writes the same two lines (formatRunLogLine in
# dashboard/src/queue/parse-stream/step-log.ts, stepMarkLine in
# step-marks.ts) and reads both back;
# dashboard/test/queue/requests/run-log-lines.test.ts runs both sides.

# A line of the run log: `aide-run-spec HH:MM:SS +Ns <text>`, the clock and
# the seconds since the step began ($step_started_at). A failure's text
# starts `error: `.
# shellcheck disable=SC2329  # called by stage and the part marks in aide-run-spec, which the sourced parts call
stage_line() {
  printf 'aide-run-spec %s +%ss %s\n' "$(date +%H:%M:%S)" "$(( $(date +%s) - step_started_at ))" "$*" >&2
}

# A step's mark: `--- Step <place>: <title> — <ending>`, the place `Aide`
# or `N of M`, the ending `started`, `done`, `skipped…` or `stopped: <why>`.
# shellcheck disable=SC2329  # called by the part marks in aide-run-spec
aide_step_mark() {   # <place> <title> <ending>
  printf -- '--- Step %s: %s — %s' "$1" "$2" "$3"
}
