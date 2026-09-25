#!/usr/bin/env bash
# run-spec-schedule-guard.sh — a scheduled run produces a report and changes no repository.
#
# Sourced by aide-run-spec after run-spec-publish.sh and before the first
# commit_and_push_roots, so every variable it reads exists.
# A session's own commits are discarded (discard_scheduled_commits); a run
# that would otherwise read as completed ends as a scope violation instead.
# A run that already ended stopped or failed keeps that ending.
if [ "$command_name" = "schedule" ]; then
  schedule_committed=""
  discard_scheduled_commits
  if [ -n "$schedule_committed" ] && [ "$terminal_reason" = "completed" ]; then
    terminal_reason="scope-violation"; ok="false"; suffix=" (stopped: scope-violation)"
    error_msg="a scheduled job cannot change the repository — it committed in $schedule_committed, and that commit was discarded. Rewrite the job's prompt so it writes its findings into the report only; a change that should reach the repository goes through a spec."
    echo "aide-run-spec: $error_msg" >&2
  fi
fi
