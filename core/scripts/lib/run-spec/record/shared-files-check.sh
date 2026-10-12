#!/usr/bin/env bash
# run-spec/record/shared-files-check.sh — an analyze whose files overlap those of
# another open spec ends stopped, naming the spec and the files.
#
# Sourced by aide-run-spec after run-spec/record/specs-guard.sh and before
# run-spec/record/criteria-check.sh, so a stop on shared files is decided first,
# as it comes first in the analyze skill (its Step 6), and before
# run-spec/record/outcome.sh, which writes the phase file's `Result:` line from
# the verdict left here.
#
# The comparison is aide-spec-overlap's; the runner judges nothing itself. It
# runs `--record` once more, which records what the session's own Step 6 missed
# and changes nothing when that ran, and then compares the record with the
# record as it stood before the turn (`--analysis`, read from the ref the turn
# started at): a spec the record already named before the turn was warned about
# then, and pressing Analyze again goes on past it. Only a spec new to the
# record stops the step. The stopped analysis keeps its work and the record, and
# the phase stays `created`.
#
# Leaves `shared_files_json` — a JSON array of {spec, files} — set only on a stop.

shared_files_json=""
if [ "$terminal_reason" = "completed" ] && [ "$command_name" = "analyze" ] && [ -f "$SCRIPT_DIR/aide-spec-overlap" ]; then
  shared_after="$("$SCRIPT_DIR/aide-spec-overlap" --specs-root "$specs_root_wt" --spec "$spec_label" --record 2>/dev/null | tail -1)"
  shared_before_file="$work_dir/analysis-before"
  : > "$shared_before_file"
  [ -n "${specs_ref_before:-}" ] && \
    git -C "$specs_root_wt/$spec_label" show "$specs_ref_before:./2-analysis.md" > "$shared_before_file" 2>/dev/null
  shared_before="$("$SCRIPT_DIR/aide-spec-overlap" --specs-root "$specs_root_wt" --spec "$spec_label" --analysis "$shared_before_file" 2>/dev/null | tail -1)"
  shared_new="$(jq -cn --argjson after "${shared_after:-null}" --argjson before "${shared_before:-null}" '
    ($before.warned // [] | map(.spec)) as $known
    | [($after.warned // [])[] | select(.spec as $s | ($known | index([$s])) | not)]' 2>/dev/null)" || shared_new=""
  if [ -z "$shared_new" ] || [ "$(jq -r '.ok // false' <<<"${shared_after:-null}" 2>/dev/null)" != "true" ]; then
    stage "shared files: the comparison with the other open specs could not be made — the step completes"
  elif [ "$shared_new" = "[]" ]; then
    stage "shared files: no other open spec changes the same files — the step completes"
  else
    shared_files_json="$shared_new"
    shared_files_said="$(jq -r 'map(.spec + ": " + (.files | join(", "))) | join("; ")' <<<"$shared_new")"
    stage "shared files: $shared_files_said — Analyze ends stopped"
    terminal_reason="shared-files"
    ok="false"
    suffix=" (stopped: shared-files)"
    amend_note="${model_suffix}${suffix}"
    error_msg="$step_button stopped: other open specs change the same files — $shared_files_said. Add them to Depends on to wait until they are archived, or press $step_button again to go on."
  fi
fi
