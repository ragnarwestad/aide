#!/usr/bin/env bash
# run-spec/record/short-analysis-check.sh — a completed analyze is logged with
# the analysis it wrote, and a SHORT analysis over a limit ends failed.
#
# Sourced by aide-run-spec after run-spec/record/shared-files-check.sh, so an
# analysis Step 6 stopped on shared files (which wrote no 3-solution.md, so no
# `Grade:`) ends on that stop and not on a missing grade, and before
# run-spec/record/criteria-check.sh and run-spec/record/outcome.sh, which act
# on the verdict left here.
#
# The analyze skill writes three fields (core/skills/aide-analyze/references/
# spec-files.md): `- **Analysis:** short|full` in 2-analysis.md's Tracking
# info, `- **Grade:**` and `- **Acceptance criteria:**` in 3-solution.md's, and
# the paths under `### Files to change` in 2-analysis.md. The limits are the
# SHORT_ANALYSIS_* constants in run-spec/setup/arguments.sh, stated to the skill
# in the prompt (run-spec/setup/invocation.sh); the runner counts the
# description's criteria itself and takes the larger count, so a wrong recorded
# one cannot let a short analysis through. The file limit counts the source
# files only (lib/files-to-change.sh's source_paths): a test and a Markdown
# file are listed but not counted. A full analysis is only logged.
# core/tests/fixtures/analysis-line.json is the table of `Analysis:` cases that
# the dashboard's parsePhaseOutcome reads too.
#
# `choose_approach` was read from the spec's own description in
# run-spec/setup/invocation.sh. Reading the Tracking info bullets and deciding
# whether an analysis is short are lib/tracking-info.sh's.

if [ "$terminal_reason" = "completed" ] && [ "$command_name" = "analyze" ]; then
  sa_dir="$specs_root_wt/$spec_label"
  sa_analysis="$(spec_analysis "$sa_dir/2-analysis.md")"
  sa_grade="$(tracking_info_field "$sa_dir/3-solution.md" "Grade")"
  sa_grade="${sa_grade%% *}"
  sa_recorded="$(tracking_info_field "$sa_dir/3-solution.md" "Acceptance criteria")"
  sa_recorded="${sa_recorded%% *}"
  case "$sa_recorded" in ''|*[!0-9]*) sa_recorded=0 ;; esac
  sa_counted="$(grep -oE '^- \*\*AC-[0-9]+' "$sa_dir/1-description.md" 2>/dev/null | sort -u | wc -l | tr -d ' ')"
  sa_criteria="$sa_recorded"
  [ "${sa_counted:-0}" -gt "$sa_criteria" ] && sa_criteria="$sa_counted"
  sa_paths="$(newest_round "$sa_dir/2-analysis.md" | section "Files to change" | paths_json 2>/dev/null)" || sa_paths="[]"
  sa_sources="$(printf '%s' "${sa_paths:-[]}" | source_paths 2>/dev/null)" || sa_sources="[]"
  sa_files="$(printf '%s' "${sa_paths:-[]}" | jq 'length' 2>/dev/null)"; sa_files="${sa_files:-0}"
  sa_source_count="$(printf '%s' "${sa_sources:-[]}" | jq 'length' 2>/dev/null)"; sa_source_count="${sa_source_count:-0}"

  sa_crossed=""
  if [ "$sa_analysis" = "short" ]; then
    sa_cross() { sa_crossed="${sa_crossed:+$sa_crossed; }$1"; }
    if [ -z "$sa_grade" ]; then
      sa_cross "no grade was recorded"
    elif [ "$sa_grade" != "$SHORT_ANALYSIS_GRADE" ]; then
      sa_cross "it is graded $sa_grade, not $SHORT_ANALYSIS_GRADE"
    fi
    [ "$sa_criteria" -gt "$SHORT_ANALYSIS_MAX_CRITERIA" ] \
      && sa_cross "it has $sa_criteria acceptance criteria, over the limit of $SHORT_ANALYSIS_MAX_CRITERIA"
    if [ "$sa_files" -eq 0 ]; then
      sa_cross "no files to change were recorded"
    elif [ "$sa_source_count" -gt "$SHORT_ANALYSIS_MAX_FILES" ]; then
      sa_cross "it has $sa_source_count source files to change, over the limit of $SHORT_ANALYSIS_MAX_FILES ($(printf '%s' "$sa_sources" | jq -r 'join(", ")'))"
    fi
    [ "${choose_approach:-}" = "yes" ] && sa_cross "it asks to choose the approach"
    [ -n "$(tracking_info_field "$sa_dir/1-description.md" "Sent back to a full analysis")" ] \
      && sa_cross "it was sent back to a full analysis"
  fi

  sa_said="short analysis: $sa_analysis — grade ${sa_grade:-unrecorded}, $sa_criteria acceptance criteria, $sa_files files to change, $sa_source_count of them source files"
  if [ "$sa_analysis" = "full" ]; then
    stage "$sa_said — the step completes"
  elif [ -z "$sa_crossed" ]; then
    stage "$sa_said — within the limits, the step completes"
  else
    stage "$sa_said — Analyze fails"
    terminal_reason="short-analysis-over-limit"
    ok="false"
    suffix=" (stopped: short-analysis-over-limit)"
    amend_note="${model_suffix}${suffix}"
    error_msg="$step_button wrote a short analysis for a spec that may not have one: $sa_crossed. Press $step_button again to have the full analysis written."
  fi
fi
