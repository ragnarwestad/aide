#!/usr/bin/env bash
# run-spec/record/no-change-check.sh — a completed analyze may record that
# what the spec asks for already holds. The runner accepts that, and sets
# `no_change_json` ({check, why}) for the result line (run-spec/publish/
# result.sh), only when all of these hold:
#
#   - the description's Tracking info reads `- **Completion without changes:** allowed`;
#   - the newest round of 2-analysis.md has `### No change needed` with a
#     non-empty `- **Check:**`, `- **Result:** passed` and a non-empty `- **Why:**`;
#   - that round's `### Files to change` lists no path;
#   - the spec's code branch holds nothing the default branch does not, so
#     the check did not pass on code an earlier implement left unmerged.
#
# Accepted, it writes the check and why it passed to the run log; a section
# that is there but not accepted is logged with what it lacks. The board ends
# the job after Analyze on the field. run-spec/record/short-analysis-check.sh,
# sourced after this file, does not refuse a short analysis for listing no
# files when the field is set. Reads lib/tracking-info.sh and
# lib/files-to-change.sh.

no_change_json=""

# The value after `- **<label>:**` in the lines on stdin, backticks dropped,
# cut to 300 characters; empty when there is none.
nc_field() {
  awk -v label="$1" '
    { prefix = "- **" label ":**" }
    index($0, prefix) == 1 { v = substr($0, length(prefix) + 1); print v; exit }' \
    | tr -d '`' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | cut -c1-300
}

if [ "$terminal_reason" = "completed" ] && [ "$command_name" = "analyze" ]; then
  nc_dir="$specs_root_wt/$spec_label"
  nc_round="$(newest_round "$nc_dir/${AIDE_ANALYSIS_FILE}")"
  if printf '%s\n' "$nc_round" | grep -qx '### No change needed'; then
    nc_section="$(printf '%s\n' "$nc_round" | section "No change needed")"
    nc_check="$(printf '%s\n' "$nc_section" | nc_field "Check")"
    nc_result="$(printf '%s\n' "$nc_section" | nc_field "Result")"
    nc_why="$(printf '%s\n' "$nc_section" | nc_field "Why")"
    nc_files="$(printf '%s\n' "$nc_round" | section "Files to change" | paths_json 2>/dev/null | jq 'length' 2>/dev/null)"
    nc_lacks=""
    [ "$(tracking_info_field "$nc_dir/${AIDE_DESCRIPTION_FILE}" "Completion without changes")" = "allowed" ] \
      || nc_lacks="the description does not allow completion without changes"
    [ -z "$nc_lacks" ] && [ -z "$nc_check" ] && nc_lacks="no check was recorded"
    [ -z "$nc_lacks" ] && [ "$nc_result" != "passed" ] && nc_lacks="the check did not pass"
    [ -z "$nc_lacks" ] && [ -z "$nc_why" ] && nc_lacks="no reason was recorded"
    [ -z "$nc_lacks" ] && [ "${nc_files:-0}" -ne 0 ] && nc_lacks="it also lists files to change"
    # Code an earlier implement left on the spec's branch is not on the
    # default branch yet: a check that passes on it says nothing about main,
    # and the job must go on to Archive to land it.
    if [ -z "$nc_lacks" ] && [ -n "${project_wt:-}" ]; then
      git -C "$project_wt" diff --quiet "$(default_ref "$project_wt" "$project_root")" HEAD -- . \
        ${git_add_excludes[@]+"${git_add_excludes[@]}"} \
        ${specs_root_excludes[@]+"${specs_root_excludes[@]}"} 2>/dev/null
      [ $? -eq 1 ] && nc_lacks="the spec's branch holds code not yet on the default branch"
    fi
    if [ -z "$nc_lacks" ]; then
      no_change_json="$(jq -cn --arg check "$nc_check" --arg why "$nc_why" '{check:$check, why:$why}')"
      stage "no change needed: $nc_check passed — $nc_why"
    else
      stage "not accepted as no change needed: $nc_lacks"
    fi
  fi
fi
