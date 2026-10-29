#!/usr/bin/env bash
# run-spec/turn/review.sh — a second pair of eyes on what implement changed,
# before the runner's own test run decides the step, and the
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
# reads the spec's own description and, with `git diff` itself, everything
# the branch changed since it left the default branch, and looks
# for defects against the description: behaviour that is wrong, broken
# or missing. It never comments on style, naming or structure — a
# constraint the runner cannot check mechanically, so it is stated in
# the prompt, the same way the runner already relies on prompt
# compliance for what a review even looks for. The prompt's words are
# in run-spec/turn/review-prompts.sh.
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

# What a verification decided for each of the numbered <defects>, given its
# reply: one `keep <n>` or `drop <n>. <why>` line per defect, and a defect
# it gives no line for is kept. A defect's text wrapped onto further
# lines is joined back into one. One line per defect: `keep<TAB><defect>`,
# or `drop<TAB><n>. <defect> — <why>`.
verified_defects() {  # <defects> <reply>
  local line n text why
  while IFS= read -r line; do
    n="$(printf '%s' "$line" | sed -nE 's/^[[:space:]]*([0-9]+)\.[[:space:]].*/\1/p')"
    [ -n "$n" ] || continue
    text="$(printf '%s' "$line" | sed -E 's/^[[:space:]]*[0-9]+\.[[:space:]]+//')"
    why="$(printf '%s\n' "$2" | grep -iE "^[[:space:]]*drop[[:space:]]+$n([^0-9]|$)" | tail -n 1)"
    if [ -n "$why" ]; then
      printf 'drop\t%s. %s — %s\n' "$n" "$text" "$(printf '%s' "$why" | sed -E 's/^[[:space:]]*[A-Za-z]+[[:space:]]+[0-9]+\.?[[:space:]]*//')"
    else
      printf 'keep\t%s\n' "$text"
    fi
  done < <(printf '%s\n' "$1" | awk '
    /^[[:space:]]*[0-9]+\.[[:space:]]/ { if (buf != "") print buf; buf = $0; next }
    NF && buf != "" { sub(/^[[:space:]]+/, ""); buf = buf " " $0 }
    END { if (buf != "") print buf }')
}

if [ "$terminal_reason" = "completed" ] && [ "$command_name" = "implement" ]; then
  implement_session="$session_out"
  running_cost="$cost"

  # The review finds what changed itself, against where the branch left
  # the default branch: an earlier attempt's commits count as much as
  # this turn's, and nothing pasted into the prompt has to be cut short.
  review_base="$(default_branch "$project_root")"
  git -C "$project_wt" rev-parse --verify --quiet "origin/$review_base" >/dev/null && review_base="origin/$review_base"
  review_fork="$(git -C "$project_wt" merge-base "$review_base" HEAD 2>/dev/null)" || review_fork="HEAD"
  review_description_path="$specs_root_wt/$spec_label/1-description.md"

  # The pictures of the pages the branch changed, when it changed any.
  screenshots_settle "$review_fork"
  review_screenshots="$(screenshots_review_line)"

  review_prompt "$review_description_path" "$review_fork" "$review_base" "$review_screenshots" "$headless_note" \
    > "$work_dir/prompt-review"

  # A fresh session (run-spec/turn/side-turn.sh): on --review-tool and
  # --review-model when the board names them, else on the step's own.
  # When that other tool does not complete — Codex out of quota, or its
  # model at capacity — the step's own model reviews instead.
  review_on="${review_tool:-$tool}"
  stage "reviewing what the step changed"
  side_reason="unavailable"
  if side_argv_for "$review_on" "$review_model" "${session_project:-} ${spec_id:-} review"; then
    side_turn "$review_on" "$work_dir/prompt-review"
    running_cost="$(jq -n --arg a "$running_cost" --arg b "$side_cost" '(($a|tonumber) + ($b|tonumber))')"
  fi
  if [ "$side_reason" != "completed" ] && [ "$review_on" != "$tool" ]; then
    stage_error "the review on $review_on did not complete (${side_reason}) — the step's own model reviews instead"
    side_argv_for "$tool" "" "${session_project:-} ${spec_id:-} review"
    side_turn "$tool" "$work_dir/prompt-review"
    running_cost="$(jq -n --arg a "$running_cost" --arg b "$side_cost" '(($a|tonumber) + ($b|tonumber))')"
  fi
  cost="$running_cost"

  if [ "$side_reason" != "completed" ]; then
    # Best-effort: the review's OWN turn shares the step's one deadline,
    # and a step whose real work is already done and committed must not
    # be reported timeout/cli-error purely because this added safety net
    # had a hiccup.
    stage_error "the review's own turn did not complete (${side_reason}) — proceeding without it"
  else
    review_verdict="$(printf '%s\n' "$side_message" | grep -iE '^review: ' | tail -n 1)"
    review_defects=""
    if [ -z "$review_verdict" ]; then
      # Still best-effort, so the step goes on, but never logged as a
      # clean review: a reply without the line may well describe defects.
      stage_error "the review's reply has no review: line — proceeding as if it found none"
    elif printf '%s' "$review_verdict" | grep -qi 'no defects found'; then
      stage "the review found no defects"
    else
      review_defects="$(printf '%s\n' "$side_message" | sed -n '/^[Rr]eview: [0-9]/,$p' | tail -n +2)"
      review_count="$(printf '%s' "$review_verdict" | grep -oE '[0-9]+' | head -1)"
      stage_error "the review found ${review_count:-an unknown number of} defect(s)"
      while IFS= read -r review_defect_line; do
        [ -n "$review_defect_line" ] && stage "review: $review_defect_line"
      done <<<"$review_defects"
    fi

    # A second fresh session, when the board names a model for it, checks
    # each defect in the code before any goes back: a review is often
    # wrong, and the implement session defends its own code. Best-effort
    # too: a verification that does not complete keeps every defect.
    if [ -n "$review_defects" ] && { [ -n "$verify_model" ] || [ -n "$verify_tool" ]; }; then
      verify_on="${verify_tool:-$tool}"
      verify_prompt "$review_description_path" "$review_fork" "$review_base" "$review_defects" "$headless_note" \
        > "$work_dir/prompt-verify"
      stage "verifying the review's defect(s)"
      side_reason="unavailable"
      if side_argv_for "$verify_on" "$verify_model" "${session_project:-} ${spec_id:-} verify"; then
        side_turn "$verify_on" "$work_dir/prompt-verify"
        running_cost="$(jq -n --arg a "$running_cost" --arg b "$side_cost" '(($a|tonumber) + ($b|tonumber))')"
        cost="$running_cost"
      fi
      if [ "$side_reason" = "completed" ]; then
        verify_decided="$(verified_defects "$review_defects" "$side_message")"
        if [ -z "$verify_decided" ]; then
          # A list with no numbered line has nothing to keep or drop by number.
          stage_error "the review's list has no numbered defect to verify — all of it goes back to the session"
        else
          review_defects=""; verify_kept=0
          while IFS="$(printf '\t')" read -r verify_action verify_line; do
            if [ "$verify_action" = "drop" ]; then
              stage "the verification dropped review: $verify_line"
            elif [ "$verify_action" = "keep" ]; then
              verify_kept=$((verify_kept + 1))
              review_defects="${review_defects:+$review_defects
}$verify_kept. $verify_line"
            fi
          done <<<"$verify_decided"
          [ -n "$review_defects" ] || stage "the verification dropped every defect — nothing goes back to the session"
        fi
      else
        stage_error "the verification did not complete (${side_reason}) — every defect goes back to the session"
      fi
    fi

    if [ -n "$review_defects" ]; then
      stage "the defect(s) went back to the implement session to be fixed"

      fix_screenshots="$(screenshots_fix_line)"
      printf '%s\n' \
        "A review of what you changed found the following defect(s), against the spec's description — not the runner's tests, which have not run yet:" \
        "" "$review_defects" \
        "" "Fix each one that is a defect, then report done. The review can be wrong: for one that is not a defect, change nothing for it, and end your reply with a line \`not a defect: <its number>. <why, naming the code that shows it>\`. The runner's own test run follows this turn." \
        ${fix_screenshots:+"$fix_screenshots"} \
        "$headless_note" \
        > "$work_dir/prompt-review-fix"

      # The same session the step's own turns ran in — never the
      # review's own throwaway session.
      resume_argv "$implement_session"
      argv=("${resumed_argv[@]}")
      run_model_turn "$work_dir/prompt-review-fix"
      cost="$(jq -n --arg a "$running_cost" --arg b "$cost" '(($a|tonumber) + ($b|tonumber))')"
      while IFS= read -r review_rejected; do
        stage "the implement session found it ${review_rejected}"
      done < <(printf '%s\n' "$turn_message" | grep -iE '^not a defect: ')
      # NOT best-effort: a fix turn that does not end completed keeps its
      # own terminal reason as the step's own outcome — defects are known
      # and unresolved. session_out is already correct: a resumed call
      # reports back the same session.
    fi
  fi
fi
