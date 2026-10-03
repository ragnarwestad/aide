#!/usr/bin/env bash
# run-spec/record/criteria-check.sh — at a spec's `criteriaChecks: stop`, an analyze
# whose plan review names a fault in the acceptance criteria ends stopped.
#
# Sourced by aide-run-spec after run-spec/record/specs-guard.sh, so a write
# outside the spec's folder is decided first, and before
# run-spec/record/outcome.sh, which writes the phase file's `Result:` line
# from the verdict left here.
#
# The analyze skill makes the checks and writes one line under the Plan
# review section's Findings line (core/skills/aide-analyze/references/
# plan-review.md): `**Criteria check:** <level> — <faults>`, the faults
# joined by `; `, or `none found`. The runner reads that line and never
# judges the criteria itself: any text after ` — ` other than `none found`
# is a fault, and a line it cannot find is said in the log, not stopped on.
# `criteria_checks` was read from the spec's own description in
# run-spec/setup/invocation.sh.

if [ "$terminal_reason" = "completed" ] && [ "$command_name" = "analyze" ] && [ "${criteria_checks:-}" = "stop" ]; then
  criteria_check_read="$(plan_review_field "$specs_root_wt/$spec_label/3-solution.md" "Criteria check")" || criteria_check_read=""
  criteria_check_faults=""
  case "$criteria_check_read" in *" — "*) criteria_check_faults="${criteria_check_read#* — }" ;; esac
  criteria_check_faults="${criteria_check_faults%.}"
  [ "$criteria_check_faults" = "none found" ] && criteria_check_faults=""
  if [ -z "$criteria_check_read" ]; then
    stage "criteria check: the Plan review section in the plan (3-solution.md) has no Criteria check line — the step completes"
  elif [ -z "$criteria_check_faults" ]; then
    stage "criteria check: $criteria_check_read — the step completes"
  else
    stage "criteria check: $criteria_check_read — Analyze ends stopped"
    # Sorted into the five kinds the board words; a contradiction keeps its
    # pair as `AC-a/AC-b`. A fault in other words still stops the step, and
    # is said in the runner's own sentence.
    criteria_missing="false"; criteria_not_ears=""; criteria_no_scenario=""
    criteria_contradictions=""; criteria_cannot_build=""
    criteria_rest="$criteria_check_faults"
    while [ -n "$criteria_rest" ]; do
      case "$criteria_rest" in
        *"; "*) criteria_part="${criteria_rest%%; *}"; criteria_rest="${criteria_rest#*; }" ;;
        *) criteria_part="$criteria_rest"; criteria_rest="" ;;
      esac
      case "$criteria_part" in
        "no acceptance criteria") criteria_missing="true" ;;
        "not in EARS: "*) criteria_not_ears="$criteria_not_ears,${criteria_part#not in EARS: }" ;;
        "no scenario for when the condition does not hold: "*)
          criteria_no_scenario="$criteria_no_scenario,${criteria_part#no scenario for when the condition does not hold: }" ;;
        "contradiction: "*) criteria_contradictions="$criteria_contradictions,${criteria_part#contradiction: }" ;;
        "cannot be built: "*) criteria_cannot_build="$criteria_cannot_build,${criteria_part#cannot be built: }" ;;
      esac
    done
    criteria_faults_json="$(jq -cn --arg missing "$criteria_missing" \
      --arg notEars "$criteria_not_ears" --arg noScenario "$criteria_no_scenario" \
      --arg contradictions "$criteria_contradictions" --arg cannotBuild "$criteria_cannot_build" '
      def ids: split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(. != ""));
      {missing: ($missing == "true"), notEars: ($notEars | ids), noScenario: ($noScenario | ids),
       contradictions: ($contradictions | ids), cannotBuild: ($cannotBuild | ids)}')"
    terminal_reason="acceptance-criteria"
    ok="false"
    suffix=" (stopped: acceptance-criteria)"
    amend_note="${model_suffix}${suffix}"
    error_msg="$step_button stopped on the acceptance criteria — $criteria_check_faults. Put the description right, then press $step_button again."
  fi
fi
