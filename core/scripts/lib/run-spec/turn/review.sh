#!/usr/bin/env bash
# run-spec/turn/review.sh — a second pair of eyes on what implement changed,
# before the runner's own test run decides the step (spec 551), and the
# log line that says what an analyze's own plan review found.
#
# Sourced by aide-run-spec between run-spec/record/status-line.sh (which can
# still downgrade terminal_reason away from "completed" for a step with
# no real progress) and run-spec/turn/step-tests.sh — so this only ever runs
# on a turn genuinely still "completed", the same gate
# run-spec/turn/step-tests.sh itself uses.
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
#
# A completed analyze gets one line of its own instead: the plan review's
# counts, read from the `**Findings:**` line the analyze skill opens its
# Plan review section with (core/skills/aide-analyze/references/
# plan-review.md), and where the findings are. The runner never counts
# the lists itself: a section without that line is logged as giving no
# counts.

# The text after `**<label>:**` on the first such line of the newest Plan
# review section in <3-solution.md>: empty for a section without that
# line, and a non-zero exit when there is no section. Fenced blocks are
# examples, not the section, and a `## Round N` heading starts over, so
# a held-back round's own review is the one read.
plan_review_field() {  # <3-solution.md> <label>
  [ -f "$1" ] || return 1
  awk -v label="**$2:**" '
    /^(```|~~~)/ { fence = !fence; next }
    fence { next }
    /^## Round [0-9]/ { found = 0; inside = 0; seen = 0; value = "" }
    /^##/ {
      match($0, /^#+/); level = RLENGTH
      if (inside && level <= at) inside = 0
      if (!inside && tolower($0) ~ /plan review/) { found = 1; inside = 1; at = level; seen = 0; value = "" }
      next
    }
    inside && !seen && index($0, label) == 1 {
      seen = 1; value = substr($0, length(label) + 1)
      sub(/^[ \t]+/, "", value); sub(/[ \t]+$/, "", value)
    }
    END { if (!found) exit 1; print value }
  ' "$1"
}

# The counts of the newest Plan review section in <3-solution.md>, as
# `<n> must-fix, <n> should-fix, <n> acted on`; `nocounts` for a section
# without a whole Findings line; nothing when there is no section.
plan_review_line() {  # <3-solution.md>
  local findings must should acted
  findings="$(plan_review_field "$1" "Findings")" || return 0
  must="$(printf '%s' "$findings" | grep -oE '[0-9]+ must-fix' | head -1)"
  should="$(printf '%s' "$findings" | grep -oE '[0-9]+ should-fix' | head -1)"
  acted="$(printf '%s' "$findings" | grep -oE '[0-9]+ acted on' | head -1)"
  if [ -z "$must" ] || [ -z "$should" ] || [ -z "$acted" ]; then echo "nocounts"; else echo "$must, $should, $acted"; fi
}

if [ "$terminal_reason" = "completed" ] && [ "$command_name" = "analyze" ]; then
  plan_review_counts="$(plan_review_line "$specs_root_wt/$spec_label/3-solution.md")"
  case "$plan_review_counts" in
    "") stage "plan review: the plan (3-solution.md) has no Plan review section" ;;
    nocounts) stage "plan review: the Plan review section in the plan (3-solution.md) gives no counts — the findings are there" ;;
    *) stage "plan review: $plan_review_counts — the findings are under Plan review in the plan (3-solution.md)" ;;
  esac
fi

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
      stage "the defect(s) went back to the implement session to be fixed"

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
