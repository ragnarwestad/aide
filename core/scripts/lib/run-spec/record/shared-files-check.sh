#!/usr/bin/env bash
# run-spec/record/shared-files-check.sh — an analyze with a required ordering
# or an overlap missing a decision ends stopped, naming the specs and files.
#
# Sourced by aide-run-spec after run-spec/record/specs-guard.sh and before
# run-spec/record/criteria-check.sh, so a stop on shared files is decided first,
# as it comes first in the analyze skill (its Step 6), and before
# run-spec/record/outcome.sh, which writes the phase file's `Result:` line from
# the verdict left here.
#
# The analysis records a reasoned decision for every overlap and completes its
# plan. Only a required ordering, or an overlap still missing a valid decision,
# stops the step. Required orderings carry their reasons to the board; bare
# file overlap never authorizes an automatic dependency update.
#
# Leaves `shared_files_json` — a JSON array of {spec, files, reason?} — on a stop.

shared_files_json=""
if [ "$terminal_reason" = "completed" ] && [ "$command_name" = "analyze" ] && [ -f "$SCRIPT_DIR/aide-spec-overlap" ]; then
  shared_after="$("$SCRIPT_DIR/aide-spec-overlap" --specs-root "$specs_root_wt" --spec "$spec_label" --record --project-dir "$project_root" 2>/dev/null | tail -1)"
  shared_new="$(jq -c '(.required // []) + (.unreviewed // .warned // [])' <<<"${shared_after:-null}" 2>/dev/null)" || shared_new=""
  if [ -z "$shared_new" ] || [ "$(jq -r '.ok // false' <<<"${shared_after:-null}" 2>/dev/null)" != "true" ]; then
    stage "shared files: the comparison with the other open specs could not be made — the step completes"
  elif [ "$shared_new" = "[]" ]; then
    stage "shared files: no unresolved or required ordering — the step completes"
  else
    shared_files_json="$shared_new"
    shared_files_said="$(jq -r 'map(.spec + ": " + (.files | join(", "))) | join("; ")' <<<"$shared_new")"
    stage "shared files: $shared_files_said — Analyze ends stopped"
    terminal_reason="shared-files"
    ok="false"
    suffix=" (stopped: shared-files)"
    amend_note="${model_suffix}${suffix}"
    error_msg="$step_button stopped: other open specs plan to change the same files as this spec — $shared_files_said"
    error_solution="add them to this spec's Depends on"
  fi
fi
