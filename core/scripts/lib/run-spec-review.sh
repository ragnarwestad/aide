#!/usr/bin/env bash
# run-spec-review.sh — a second pair of eyes on what implement changed,
# before the runner's own test run decides the step (spec 551).
#
# Sourced by aide-run-spec between run-spec-status-line.sh (which can
# still downgrade terminal_reason away from "completed" for a step with
# no real progress) and run-spec-step-tests.sh — so this only ever runs
# on a turn genuinely still "completed", the same gate
# run-spec-step-tests.sh itself uses.
#
# A green test run proves only what the tests cover; a defect no test
# reaches — how a gesture behaves in the browser, say — passes implement
# unnoticed. So a fresh AI session, same model/effort/tool as the step,
# reads the spec's own description and a diff of what changed, and looks
# for defects against the description: behaviour that is wrong, broken
# or missing. It never comments on style, naming or structure — a
# constraint the runner cannot check mechanically, so it is stated in
# the prompt, the same way the runner already relies on prompt
# compliance for what a review even looks for.
#
# When it names one or more defects, they go back to the ORIGINAL
# implement session as ONE follow-up (fix) turn — the same `resume_argv`
# mechanism a red test's fix turn already uses. That turn's own failure
# stands as the step's outcome: defects are by then known and
# unresolved. The review's OWN turn, before any defect is known, carries
# no such justification — it is best-effort, and any outcome other than
# a clean "no defects" falls back to "found nothing" instead of failing
# an otherwise-successful, already-committed implement over an added
# safety net's own hiccup.
if [ "$terminal_reason" = "completed" ] && [ "$command_name" = "implement" ]; then
  implement_session="$session_out"
  running_cost="$cost"

  # A fresh session, same tool/model/effort as the step (fresh_argv),
  # minus the one collision: fresh_argv still carries claude's
  # --session-id from the run's own pre-minted UUID, already spent by
  # the main turn when it ran fresh. Let claude mint its own.
  review_argv=(); review_skip="no"
  for review_arg in "${fresh_argv[@]}"; do
    if [ "$review_skip" = "yes" ]; then review_skip="no"; continue; fi
    case "$review_arg" in
      --session-id) review_skip="yes" ;;
      *) review_argv+=("$review_arg") ;;
    esac
  done

  review_diff="$(git -C "$project_wt" diff HEAD 2>/dev/null | head -c 20000)"
  review_untracked="$(git -C "$project_wt" status --porcelain --untracked-files=all 2>/dev/null | awk '$1=="??"{print $2}')"
  review_description="$(cat "$specs_root_wt/$spec_label/1-description.md" 2>/dev/null)"

  printf '%s\n' \
    "Read this spec's own description and what this step changed, and look for defects: behaviour that is wrong, broken or missing against the description. Say nothing about style, naming or structure." \
    "" "Spec description:" "$review_description" \
    "" "What changed (git diff):" "$review_diff" \
    "" "Untracked files this step added: ${review_untracked:-none}" \
    "" "Do not edit, create or delete any file — you are reading and reporting only." \
    "" "End your reply with exactly one of these, as your very last lines, plain text, no other formatting:" \
    "review: no defects found" \
    "or" \
    "review: N defect(s) found" \
    "1. <the defect, one sentence>" \
    "2. <the defect, one sentence>" \
    "$headless_note" \
    > "$work_dir/prompt-review"

  stage "reviewing what the step changed"
  argv=("${review_argv[@]}")
  run_model_turn "$work_dir/prompt-review"
  running_cost="$(jq -n --arg a "$running_cost" --arg b "$cost" '(($a|tonumber) + ($b|tonumber))')"

  if [ "$terminal_reason" != "completed" ]; then
    # Best-effort: the review's OWN turn shares the step's one deadline,
    # and a step whose real work is already done and committed must not
    # be reported timeout/cli-error purely because this added safety net
    # had a hiccup.
    stage_error "the review's own turn did not complete (${terminal_reason}) — proceeding without it"
    terminal_reason="completed"; error_msg=""
    session_out="$implement_session"; cost="$running_cost"
  else
    review_verdict="$(printf '%s\n' "$turn_message" | grep -iE '^review: ' | tail -n 1)"
    if [ -z "$review_verdict" ] || printf '%s' "$review_verdict" | grep -qi 'no defects found'; then
      stage "the review found no defects"
      session_out="$implement_session"; cost="$running_cost"
    else
      review_defects="$(printf '%s\n' "$turn_message" | sed -n '/^[Rr]eview: [0-9]/,$p' | tail -n +2)"
      review_count="$(printf '%s' "$review_verdict" | grep -oE '[0-9]+' | head -1)"
      stage_error "the review found ${review_count:-an unknown number of} defect(s) — handing them to the session"
      while IFS= read -r review_defect_line; do
        [ -n "$review_defect_line" ] && stage "review: $review_defect_line"
      done <<<"$review_defects"

      printf '%s\n' \
        "A review of what you changed found the following defect(s), against the spec's description — not the runner's tests, which have not run yet:" \
        "" "$review_defects" \
        "" "Fix them, then report done. The runner's own test run follows this turn." \
        "$headless_note" \
        > "$work_dir/prompt-review-fix"

      # The same session the step's own turns ran in — never the
      # review's own throwaway session.
      resume_argv "$implement_session"
      argv=("${resumed_argv[@]}")
      run_model_turn "$work_dir/prompt-review-fix"
      cost="$(jq -n --arg a "$running_cost" --arg b "$cost" '(($a|tonumber) + ($b|tonumber))')"
      # NOT best-effort: a fix turn that does not end completed keeps its
      # own terminal reason as the step's own outcome — defects are known
      # and unresolved. session_out is already correct: a resumed call
      # reports back the same session.
    fi
  fi
fi
