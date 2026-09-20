#!/usr/bin/env bash
# run-spec-boundary.sh — reopen and reset's own boundary mark.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were.
# --- reopen/reset's own boundary mark (spec 356, REQ-5) ---------------------
# Written by this script, not by whatever moved the files: the scripts
# above (`aide-reopen-spec`, then `aide-reset-spec` for --reset-files)
# resolve the folder and write 2-analysis.md/3-solution.md/4-status.md
# from the templates, and the skills a person runs at a keyboard call the
# same two — none of them writes the `**Reopened:**`/`**Reset:**` mark
# itself. That mark is written here, once the step has moved the folder
# back to its active path and written the file, using the boundary sha captured
# before any of this run's own commits existed (the branch-deletion loop
# above this one). A reopen that keeps the files writes no such mark: its
# script (aide-reopen-spec) stamps a `**Round boundary:**` line itself.
if { { [ "$command_name" = "reopen" ] && [ "$reset_files" = "yes" ]; } || [ "$command_name" = "reset" ]; } && \
   [ "$terminal_reason" = "completed" ] && [ -n "$reopen_boundary_sha" ] && \
   declare -f apply_spec_transition >/dev/null 2>&1; then
  reopen_status_file="$specs_root_wt/$spec_folder/4-status.md"
  if [ -f "$reopen_status_file" ]; then
    apply_spec_transition "$reopen_status_file" "$command_name" "$reopen_boundary_sha"
  fi
fi
