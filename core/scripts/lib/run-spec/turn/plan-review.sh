#!/usr/bin/env bash
# run-spec/turn/plan-review.sh — an analyze's plan review on an AI and model
# of its own, chosen as Review under Analyze on the board
# (--plan-review-model, --plan-review-tool).
#
# Sourced by aide-run-spec right after the step's own turn
# (run-spec/turn/spec-paths.sh) and before the commit and analyze's checks
# (run-spec/checkout/cleanup.sh, run-spec/record/status-line.sh), so what
# the follow-up turn writes is committed and checked as the first turn's is.
#
# With such a choice the analyze prompt carries one more line
# (run-spec/setup/invocation.sh): the session writes its plan, and when its
# Step 8 runs it ends its reply with `plan review: handed over` and ends its
# turn. The session alone decides whether Step 8 runs, as it always has; a
# reply without that line is a review skipped or done in the session.
#
# On a handover the runner starts one fresh read-only session on the chosen
# AI and model, which runs the three reviewers of the installed routine
# (core/skills/aide-analyze/references/plan-review.md) and reports them,
# ending `plan review: done`. Their findings go back to the ORIGINAL analyze
# session as one follow-up turn, which consolidates them, revises the plan
# and finishes the step, as review.sh's fix turn does for implement. A
# review that gives no findings stops the step, naming Review, the model and
# the reason; it never falls back to another model.

# The text after `**<label>:**` on the first such line of the newest Plan
# review section in <3-solution.md>: empty for a section without that
# line, and a non-zero exit when there is no section. Fenced blocks are
# examples, not the section, and a `## Round N` heading starts over, so
# a held-back round's own review is the one read.
plan_review_field() {  # <solution file> <label>
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

# The plan review routine: the copy beside the runner's own folder in a
# checkout, else Claude Code's installed skills, else the shared ones.
plan_review_routine() {
  local candidate
  for candidate in "${RUNNER_ORIGIN_DIR:-$SCRIPT_DIR}/../skills/aide-analyze/references/plan-review.md" \
    "$HOME/.claude/skills/aide-analyze/references/plan-review.md" \
    "$HOME/.agents/skills/aide-analyze/references/plan-review.md"; do
    [ -f "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

# Whether <reply>'s last line that is not empty is <line>, backticks and
# surrounding blanks aside.
reply_ends_with() {  # <reply> <line>
  printf '%s\n' "$1" | awk -v want="$2" '
    NF { last = $0 }
    END { gsub(/`/, "", last); sub(/^[ \t]+/, "", last); sub(/[ \t]+$/, "", last); exit !(tolower(last) == want) }'
}

if [ "$terminal_reason" = "completed" ] && [ "$command_name" = "analyze" ] \
  && { [ -n "$plan_review_model" ] || [ -n "$plan_review_tool" ]; }; then
  plan_review_on="${plan_review_tool:-$tool}"
  plan_review_shown="${plan_review_model:-$plan_review_on}"
  if reply_ends_with "$turn_message" "plan review: handed over"; then
    analyze_session="$session_out"
    running_cost="$cost"
    stage "reviewing the plan on $plan_review_shown"
    side_reason="unavailable"; side_error=""; side_message=""
    if ! plan_review_routine_path="$(plan_review_routine)"; then
      side_error="the plan review routine (aide-analyze/references/plan-review.md) is not installed"
    else
      plan_review_prompt "$plan_review_routine_path" "$specs_root_wt/$spec_label" "$project_wt" \
        "${criteria_checks:-off}" "${choose_approach:-no}" "$headless_note" > "$work_dir/prompt-plan-review"
      if side_argv_for "$plan_review_on" "$plan_review_model" "${session_project:-} ${spec_id:-} plan review" "$plan_review_bin"; then
        side_turn "$plan_review_on" "$work_dir/prompt-plan-review" \
          "${plan_review_claude_config_dir:-$claude_config_dir}" "${plan_review_codex_home:-$codex_home_arg}"
        running_cost="$(jq -n --arg a "$running_cost" --arg b "$side_cost" '(($a|tonumber) + ($b|tonumber))')"
        side_counted
      else
        side_error="$plan_review_on could not be started"
      fi
    fi
    cost="$running_cost"

    plan_review_done=""
    printf '%s\n' "$side_message" | grep -qiE '^[[:space:]`]*plan review: done[[:space:]`]*$' && plan_review_done="yes"
    # The findings are what the reply says before its done line: a reply
    # with nothing else is a review that was not done.
    plan_review_findings="$(printf '%s\n' "$side_message" | grep -viE '^[[:space:]`]*plan review: done[[:space:]`]*$' | grep -v '^[[:space:]]*$')"
    if [ "$side_reason" = "completed" ] && [ -z "$plan_review_done" ]; then
      side_reason="no-progress"; side_error="its reply has no plan review: done line"
    elif [ "$side_reason" = "completed" ] && [ -z "$plan_review_findings" ]; then
      side_reason="no-progress"; side_error="its reply gives no reviewer's findings"
    fi
    if [ "$side_reason" = "provider-limit" ] && [ -n "$plan_review_done" ]; then
      stage_error "Review on $plan_review_shown reached its provider limit — its findings still go back to the analyze session"
    elif [ "$side_reason" != "completed" ]; then
      side_failure "Review" "$plan_review_on" "$plan_review_model"
    fi

    if [ "$terminal_reason" = "completed" ]; then
      stage "the plan review's findings went back to the analyze session"
      plan_review_findings_prompt "$side_message" "$plan_review_routine_path" "$headless_note" \
        > "$work_dir/prompt-plan-review-findings"
      # The analyze session's own, never the review's throwaway one.
      resume_argv "$analyze_session"
      argv=("${resumed_argv[@]}")
      running_tokens="${tokens_json:-}"
      run_model_turn "$work_dir/prompt-plan-review-findings" plan_review_findings_result
      cost="$(jq -n --arg a "$running_cost" --arg b "$cost" '(($a|tonumber) + ($b|tonumber))')"
      sides_priced_again
      tokens_json="$(turn_tokens_add "$running_tokens" "${tokens_json:-}")"
      # That turn's outcome is the step's (run-spec/turn/step-tests.sh sets
      # `ok` from it).
    fi
  elif plan_review_field "$specs_root_wt/$spec_label/${AIDE_SOLUTION_FILE}" "Findings" >/dev/null; then
    stage_error "the analyze session reviewed its plan itself; Review on $plan_review_shown did not run"
  fi
fi
