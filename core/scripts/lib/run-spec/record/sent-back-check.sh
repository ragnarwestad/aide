#!/usr/bin/env bash
# run-spec/record/sent-back-check.sh — an implement whose session wrote the
# sentence file its prompt names (run-spec/turn/spec-paths.sh) found the spec is
# not small after all. On a short analysis the step ends `sent-back` and the
# sentence is kept in the description; on a full one, or on a description that
# cannot hold the line, it ends `sent-back-refused`, failed, with the
# description as it was.
#
# Sourced by aide-run-spec after run-spec/checkout/cleanup.sh, which sets the
# `model_suffix` this check reads (the runner runs under `set -u`), and before
# run-spec/record/records.sh, so the verdict is decided ahead of the
# no-progress cross-check in run-spec/record/status-line.sh, the code review and
# the step's test run, which all act on a `completed` step only. A step that
# wrote no sentence, or one that is empty once cleaned, is left exactly as it
# was.
#
# The sentence is joined to one line, stripped of backticks and cut to 300
# characters, as run-spec/record/outcome.sh does for `Result:`. Whether the
# analysis is short is lib/tracking-info.sh's, over the table
# core/tests/fixtures/analysis-line.json; the line recorded is read back by
# run-spec/setup/invocation.sh and run-spec/record/short-analysis-check.sh, and
# by the dashboard's parsePhaseOutcome over core/tests/fixtures/sent-back-line.json.

sent_back_why=""
sent_back_refusal=""
if [ "$terminal_reason" = "completed" ] && [ "$command_name" = "implement" ] && [ -f "$sent_back_file" ]; then
  sb_dir="$specs_root_wt/$spec_label"
  sent_back_why="$(tr '\n\r' '  ' < "$sent_back_file" | tr -d '`' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' \
    | cut -c1-300 | sed 's/[[:space:]]*$//')"
  if [ -z "$sent_back_why" ]; then
    stage "sent back: the sentence file is empty — the step is judged as it stands"
  else
    if [ "$(spec_analysis "$sb_dir/2-analysis.md")" != "short" ]; then
      sent_back_refusal="its analysis is already full"
    elif ! record_sent_back "$sb_dir/1-description.md" "$sent_back_why"; then
      sent_back_refusal="the description has no Created line to record it under"
    fi
    if [ -z "$sent_back_refusal" ]; then
      stage "sent back: $sent_back_why — Implement ends, Analyze runs again with a full analysis"
      terminal_reason="sent-back"
      error_msg="$step_button sent the spec back to a full analysis: $sent_back_why Analyze runs again with a full analysis, then $step_button."
    else
      stage "sent back: refused, $sent_back_refusal — Implement fails"
      terminal_reason="sent-back-refused"
      error_msg="$step_button asked to send the spec back to a full analysis, but $sent_back_refusal: $sent_back_why Run Analyze again for a new plan, or press $step_button again to build the one there is."
    fi
    ok="false"
    suffix=" (stopped: $terminal_reason)"
    amend_note="${model_suffix}${suffix}"
  fi
fi
