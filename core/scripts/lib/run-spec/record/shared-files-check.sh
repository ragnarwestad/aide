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
  # Members of one persisted group deliberately build on one another's
  # branch, so their overlap is not an ordering problem.
  current_group="$(sed -n 's/^[[:space:]]*-[[:space:]]*\*\*Group:\*\*[[:space:]]*`\{0,1\}\([^`]*\)`\{0,1\}[[:space:]]*$/\1/p' "$specs_root_wt/$spec_label/$AIDE_DESCRIPTION_FILE" 2>/dev/null | head -1)"
  if [ -n "$shared_new" ] && [ -n "$current_group" ]; then
    kept='[]'
    shared_index=0
    shared_count="$(jq 'length' <<<"$shared_new")"
    while [ "$shared_index" -lt "$shared_count" ]; do
      shared_spec="$(jq -r ".[${shared_index}].spec" <<<"$shared_new")"
      other_group="$(sed -n 's/^[[:space:]]*-[[:space:]]*\*\*Group:\*\*[[:space:]]*`\{0,1\}\([^`]*\)`\{0,1\}[[:space:]]*$/\1/p' "$specs_root_wt/$shared_spec/$AIDE_DESCRIPTION_FILE" 2>/dev/null | head -1)"
      if [ "$other_group" != "$current_group" ]; then
        kept="$(jq -c --argjson item "$(jq ".[${shared_index}]" <<<"$shared_new")" '. + [$item]' <<<"$kept")"
      fi
      shared_index=$((shared_index + 1))
    done
    shared_new="$kept"
  fi
  if [ -z "$shared_new" ] || [ "$(jq -r '.ok // false' <<<"${shared_after:-null}" 2>/dev/null)" != "true" ]; then
    stage "shared files: the comparison with the other open specs could not be made — the step completes"
  elif [ "$shared_new" = "[]" ]; then
    stage "shared files: no unresolved or required ordering — the step completes"
  else
    shared_files_json="$shared_new"
    shared_files_said=""
    shared_index=0
    shared_count="$(jq 'length' <<<"$shared_new")"
    while [ "$shared_index" -lt "$shared_count" ]; do
      shared_spec="$(jq -r ".[${shared_index}].spec" <<<"$shared_new")"
      shared_files="$(jq -r ".[${shared_index}].files | join(\", \")" <<<"$shared_new")"
      [ -z "$shared_files_said" ] || shared_files_said="$shared_files_said; "
      shared_files_said="$shared_files_said$(aide_spec_reference "$project_name" "$shared_spec"): $shared_files"
      shared_index=$((shared_index + 1))
    done
    stage "shared files: $shared_files_said — Analyze ends stopped"
    stop_step shared-files "$step_button stopped: other open specs plan to change the same files as this spec — $shared_files_said" \
      "add them to this spec's Depends on"
  fi
fi
