#!/usr/bin/env bash
# run-spec/turn/review-prompts.sh — the words implement's review and its
# verification are given (run-spec/turn/review.sh), and an analyze's plan
# review and the findings it hands back (run-spec/turn/plan-review.sh).
# Also how both replies are read: the review part, its numbered findings,
# and the verification's decision for each.
# Kept apart from the turns that send them so scripts/review_eval measures
# the very prompts the runner sends, and reads the replies by the runner's
# own rule: it sources this file beside _aide-spec-lib.sh.

# Interface behaviour is reviewed against the project rules as well as the spec.
review_design_instruction() {
  printf '%s\n' "For a user-interface change, read the project's CLAUDE.md or AGENTS.md and the design rules they point to for the changed files. Compare with the existing control named as the reference in the description or plan; when none is named, locate the nearest control with the same role. Check the component and variant, opening, closing, keyboard behaviour, and feedback or navigation after the action. A concrete violation of those rules is a defect even when the description does not repeat the rule; this is not a request for stylistic preferences or a redesign. Follow the project's visual verification requirements: inspect the recorded browser comparison or verify it yourself where possible, and report any missing verification separately without claiming the appearance is verified."
}

# The review's prompt: look for defects in what the branch changed since
# <fork>, against the description at <description-path>. A description
# with an `## Out of scope` section adds one instruction: each change
# under an item in it is a defect too.
# An existing test the branch weakened is a defect in every review,
# unless the description replaces or removes what it checked.
review_prompt() {  # <description-path> <fork> <base> <screenshots-line> <headless-note>
  local scope=""
  if [ -n "$(aide_out_of_scope_section "$(cat "$1" 2>/dev/null)")" ]; then
    scope="The description has an ## Out of scope section: what this change must not do or touch. Each change in the diff that falls under an item in it is a defect too, whatever kind of change it is, style, naming and structure included; say which item."
  fi
  printf '%s\n' \
    "Read this spec's own description and everything this spec's branch changed, and look for defects: behaviour that is wrong, broken or missing against the description. Say nothing about stylistic preferences, naming or structure." \
    "" "Report a defect only when you can name the concrete case: the input or state, and the wrong result the code gives for it. A guard that might be missing, or a state the code cannot reach, is not a defect." \
    "" "An existing test the branch weakened is a defect too: one it deleted, one with an assertion removed or loosened, or one it marked as skipped or disabled. An existing test is one that was there where the branch left $3; one moved or renamed that still checks the same behaviour is not deleted. Its concrete case is the test and what it no longer checks. It is not a defect when the description replaces or removes the behaviour that test checked." \
    "" "The description: $1" \
    "" "What changed: run \`git diff $2\` in this directory, for every change since the branch left $3, committed or not, and \`git status --porcelain\` for new files not tracked yet. Read a whole file wherever the diff alone does not show enough."
  printf '%s\n' "" "$(review_design_instruction)"
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
    "A review of this spec's branch reported the defects below against the spec's own description and applicable project design rules. A review is often wrong. Check each one yourself in the code before anyone acts on it." \
    "" "Keep a defect only when you have traced a concrete case through the code: a state the code can reach, and the wrong result it gives there, against what the description or applicable project design rules require. Drop it when the code already handles the case, when the state cannot be reached, when it is only a guard that might be missing, or when neither the description nor the applicable project rules require what it says is missing." \
    "" "A defect about an existing test the branch weakened — one deleted, an assertion removed or loosened, or one marked as skipped or disabled — is checked on these terms instead: keep it when the diff shows the test weakened and the description does not replace or remove the behaviour that test checked. Drop it when the description replaces or removes that behaviour, or when the test was only moved or renamed and still checks the same behaviour." \
    "" "The description: $1" \
    "" "What changed: run \`git diff $2\` in this directory, for every change since the branch left $3, committed or not, and \`git status --porcelain\` for new files not tracked yet. Read a whole file wherever the diff alone does not show enough." \
    "" "$(review_design_instruction)" \
    "" "The defects:" "" "$4" \
    "" "Do not edit, create or delete any file — you are reading and reporting only." \
    "" "End your reply with one line for each defect, in the order of their numbers, as your very last lines, plain text, no other formatting:" \
    "keep <its number>" \
    "or" \
    "drop <its number>. <why, naming the code that shows it>" \
    "$5"
}

# The review part of a review's <reply>: the LAST `review: ` line, in any
# case, then every line after it. The first line is the verdict, the lines
# after it the defects. Nothing for a reply with no such line.
review_reply_part() {  # <reply>
  printf '%s\n' "$1" | awk '
    tolower($0) ~ /^review: / { part = $0; found = 1; next }
    found { part = part "\n" $0 }
    END { if (found) print part }'
}

# The numbered findings in <defects>, one per line: `<n><TAB><text>`. A
# line `<n>. <text>`, or `<n>.` with its text on the lines below, starts
# a finding; a non-blank line after it is joined
# on with one space, and spaces around each piece are trimmed. Lines
# before the first numbered one are not findings. Nothing when no line
# is numbered.
review_reply_findings() {  # <defects>
  printf '%s\n' "$1" | awk '
    function trim(s) { sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); return s }
    function flush() { if (have) print n "\t" text }
    /^[[:space:]]*[0-9]+\.([[:space:]]|$)/ {
      flush(); have = 1
      n = $0; sub(/^[[:space:]]*/, "", n); sub(/\..*$/, "", n)
      text = $0; sub(/^[[:space:]]*[0-9]+\./, "", text); text = trim(text)
      next
    }
    have && NF { text = (text == "" ? "" : text " ") trim($0) }
    END { flush() }'
}

# What a verification's <reply> decided for finding <n>: the LAST line
# `keep <n>` or `drop <n>. <why>`, in any case, decides, and the number
# ends at any non-digit. Prints `keep<TAB><why>` or `drop<TAB><why>`; a
# finding with no line is kept, `keep<TAB>no line for it`.
verify_reply_decision() {  # <reply> <n>
  case "$2" in '' | *[!0-9]*) return 1 ;; esac
  printf '%s\n' "$1" | awk -v n="$2" '
    function trim(s) { sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); return s }
    tolower($0) ~ ("^[[:space:]]*(keep|drop)[[:space:]]+" n "([^0-9]|$)") {
      action = trim($0); action = tolower(substr(action, 1, 4))
      why = $0; sub(/^[[:space:]]*[A-Za-z]+[[:space:]]+[0-9]+\.?/, "", why); why = trim(why)
    }
    END { if (action == "") print "keep\tno line for it"; else print action "\t" why }'
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
