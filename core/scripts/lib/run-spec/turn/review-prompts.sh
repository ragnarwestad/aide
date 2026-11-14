#!/usr/bin/env bash
# run-spec/turn/review-prompts.sh — the words implement's review and its
# verification are given (run-spec/turn/review.sh), and an analyze's plan
# review and the findings it hands back (run-spec/turn/plan-review.sh).
# Kept apart from the turns that send them so scripts/review_eval measures
# the very prompts the runner sends: it sources this file beside _aide-spec-lib.sh.

# The review's prompt: look for defects in what the branch changed since
# <fork>, against the description at <description-path>. A description
# with an `## Out of scope` section adds one instruction: each change
# under an item in it is a defect too.
review_prompt() {  # <description-path> <fork> <base> <screenshots-line> <headless-note>
  local scope=""
  if [ -n "$(aide_out_of_scope_section "$(cat "$1" 2>/dev/null)")" ]; then
    scope="The description has an ## Out of scope section: what this change must not do or touch. Each change in the diff that falls under an item in it is a defect too, whatever kind of change it is, style, naming and structure included; say which item."
  fi
  printf '%s\n' \
    "Read this spec's own description and everything this spec's branch changed, and look for defects: behaviour that is wrong, broken or missing against the description. Say nothing about style, naming or structure." \
    "" "Report a defect only when you can name the concrete case: the input or state, and the wrong result the code gives for it. A guard that might be missing, or a state the code cannot reach, is not a defect." \
    "" "The description: $1" \
    "" "What changed: run \`git diff $2\` in this directory, for every change since the branch left $3, committed or not, and \`git status --porcelain\` for new files not tracked yet. Read a whole file wherever the diff alone does not show enough."
  [ -n "$scope" ] && printf '%s\n' "" "$scope"
  [ -n "$4" ] && printf '%s\n' "" "$4"
  printf '%s\n' \
    "" "Do not edit, create or delete any file — you are reading and reporting only." \
    "" "End your reply with exactly one of these, as your very last lines, plain text, no other formatting:" \
    "review: no defects found" \
    "or" \
    "review: N defect(s) found" \
    "1. <the defect and its concrete case, one sentence>" \
    "2. <the defect and its concrete case, one sentence>" \
    "$5"
}

# The verification's prompt: check each numbered defect in <defects>
# against the code, and keep or drop it.
verify_prompt() {  # <description-path> <fork> <base> <defects> <headless-note>
  printf '%s\n' \
    "A review of this spec's branch reported the defects below against the spec's own description. A review is often wrong. Check each one yourself in the code before anyone acts on it." \
    "" "Keep a defect only when you have traced a concrete case through the code: a state the code can reach, and the wrong result it gives there, against what the description asks for. Drop it when the code already handles the case, when the state cannot be reached, when it is only a guard that might be missing, or when the description does not ask for what it says is missing." \
    "" "The description: $1" \
    "" "What changed: run \`git diff $2\` in this directory, for every change since the branch left $3, committed or not, and \`git status --porcelain\` for new files not tracked yet. Read a whole file wherever the diff alone does not show enough." \
    "" "The defects:" "" "$4" \
    "" "Do not edit, create or delete any file — you are reading and reporting only." \
    "" "End your reply with one line for each defect, in the order of their numbers, as your very last lines, plain text, no other formatting:" \
    "keep <its number>" \
    "or" \
    "drop <its number>. <why, naming the code that shows it>" \
    "$5"
}

# The plan review's prompt: run the three reviewers of the routine at
# <routine> on the spec in <spec-dir>, and report each one's findings
# without acting on them. The analyze session consolidates and revises.
plan_review_prompt() {  # <routine> <spec-dir> <project-dir> <criteria-checks> <choose-approach> <headless-note>
  local approach="off"
  [ "$5" = "yes" ] && approach="on"
  printf '%s\n' \
    "Run the three reviewers of the \"Review\" section in $1 on the implementation plan of the spec below, exactly as that section says: Feasibility, Scope guardian and Coherence, each blind to the others' findings — a subagent of its own each where you can start one, else three passes one after another." \
    "" "The spec's four files: $2" \
    "The project, which the Feasibility reviewer reads: $3" \
    "The acceptance criteria checks level, for Feasibility and Coherence: criteriaChecks: $4" \
    "Let me choose the approach is $approach for this spec, for Coherence." \
    "" "Do not consolidate the findings and do not revise the plan: the session that wrote it does both. Do not edit, create or delete any file — you are reading and reporting only." \
    "" "Give each reviewer's findings and verdict under a heading of its own, named for the reviewer, and end your reply with this line, as your very last line, plain text:" \
    "plan review: done" \
    "$6"
}

# The prompt that hands the plan review's <findings> back to the analyze
# session, to finish Step 8 from Consolidate in <routine>.
plan_review_findings_prompt() {  # <findings> <routine> <headless-note>
  printf '%s\n' \
    "The plan review's three reviewers reported the findings below, each blind to the others, on the plan you wrote. Go on with Step 8 from the \"Consolidate\" section in $2: consolidate these findings, revise the plan and write its Plan review section. Then do Step 9 and Step 10, and finish the step." \
    "" "The findings, as the reviewers gave them:" "" "$1" \
    "" "$3"
}
