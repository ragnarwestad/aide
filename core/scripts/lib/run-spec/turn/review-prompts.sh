#!/usr/bin/env bash
# run-spec/turn/review-prompts.sh — the words implement's review and its
# verification are given (run-spec/turn/review.sh), and an analyze's plan
# review and the findings it hands back (run-spec/turn/plan-review.sh).
# Also how both replies are read: the review part, its numbered findings,
# and the verification's decision for each.
# Kept apart from the turns that send them so scripts/review_eval measures
# the very prompts the runner sends, and reads the replies by the runner's
# own rule: it sources this file beside _aide-spec-lib.sh and lib/spec-reference.sh.

# Interface behaviour is reviewed against the project rules as well as the spec.
review_design_instruction() {
  printf '%s\n' "For a user-interface change, read the project's CLAUDE.md or AGENTS.md and the design rules they point to for the changed files. Compare with the existing control named as the reference in the description or plan; when none is named, locate the nearest control with the same role. Check the component and variant, opening, closing, keyboard behaviour, and feedback or navigation after the action. A concrete violation of those rules is a defect even when the description does not repeat the rule; this is not a request for stylistic preferences or a redesign. Follow the project's visual verification requirements: inspect the recorded browser comparison or verify it yourself where possible, and report any missing verification separately without claiming the appearance is verified."
}

# The change-specific checks: each file in review-checks/ names, in its
# `paths:` frontmatter, the globs of the code it applies to, and its body
# is what the review and the verification are given for a diff touching
# them. Found beside this file, so the runner, its installed copy and
# scripts/review_eval read the same checks.
REVIEW_CHECKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/review-checks"

# The globs in a check file's `paths:` frontmatter, one per line.
review_check_globs() {  # <check-file>
  awk 'NR == 1 && /^---$/ { fm = 1; next }
    fm && /^---$/ { exit }
    fm && /^[[:space:]]*-[[:space:]]/ { sub(/^[[:space:]]*-[[:space:]]*/, ""); gsub(/^"|"$/, ""); print }' "$1"
}

# The text of every check in review-checks/ whose paths: a file the branch
# changed since <fork> in <project-dir> matches, tracked or not, a blank
# line between two. Nothing with no project directory, no repository
# there, a git failure, or nothing matching. `[[ == ]]` lets `*` match
# across `/`, so `dir/*` covers a whole folder.
review_change_checks() {  # <project-dir> <fork>
  local changed check glob path matched out=""
  [ -n "$1" ] && [ -n "$2" ] || return 0
  changed="$({ git -C "$1" diff --name-only "$2" && git -C "$1" ls-files --others --exclude-standard; } 2>/dev/null)" \
    || return 0
  [ -n "$changed" ] || return 0
  for check in "$REVIEW_CHECKS_DIR"/*.md; do
    [ -f "$check" ] || continue
    matched=""
    while IFS= read -r glob; do
      [ -n "$glob" ] || continue
      while IFS= read -r path; do
        # shellcheck disable=SC2053 # the glob is a pattern on purpose
        if [[ $path == $glob ]]; then matched=1; break 2; fi
      done <<<"$changed"
    done < <(review_check_globs "$check")
    [ -n "$matched" ] || continue
    out="${out:+$out

}$(awk 'NR == 1 && /^---$/ { fm = 1; next } fm == 1 && /^---$/ { fm = 2; next } fm != 1' "$check" | sed '/./,$!d')"
  done
  [ -n "$out" ] && printf '%s\n' "$out"
  return 0
}

# The spec's analysis: the file AIDE_ANALYSIS_FILE names (spec-reference.sh),
# beside the description at <description-path>.
review_analysis_path() {  # <description-path>
  printf '%s\n' "$(dirname "$1")/$AIDE_ANALYSIS_FILE"
}

# The newest `### Threats` section of the spec's analysis: its heading and
# every line up to the next heading of level 1-3 or a `---` line. The last
# one in the file wins, so a later round's section replaces an earlier
# one. Nothing when there is none, or when spec-reference.sh is not loaded.
review_threat_section() {  # <description-path>
  local analysis
  [ -n "${AIDE_ANALYSIS_FILE:-}" ] || return 0
  analysis="$(review_analysis_path "$1")"
  [ -f "$analysis" ] || return 0
  awk '
    (/^#{1,3}[ \t]/ || /^---[ \t\r]*$/) && inside { inside = 0 }
    /^###[ \t]+Threats[ \t\r]*$/ { inside = 1; n = 0 }
    inside { sub(/[ \t\r]+$/, ""); line[++n] = $0 }
    END { for (i = 1; i <= n; i++) print line[i] }
  ' "$analysis"
}

# The review's prompt: look for defects in what the branch changed since
# <fork>, against the description at <description-path>. A description
# with an `## Out of scope` section adds one instruction: each change
# under an item in it is a defect too.
# An existing test the branch weakened is a defect in every review,
# unless the description replaces or removes what it checked. With a
# <project-dir>, the change-specific checks the diff touches are added.
# Every review also checks security fixes and the analysis's threats.
review_prompt() {  # <description-path> <fork> <base> <screenshots-line> <headless-note> [<project-dir>]
  local scope="" checks threats=""
  if [ -n "$(aide_out_of_scope_section "$(cat "$1" 2>/dev/null)")" ]; then
    scope="The description has an ## Out of scope section: what this change must not do or touch. Each change in the diff that falls under an item in it is a defect too, whatever kind of change it is, style, naming and structure included; say which item."
  fi
  if [ -n "$(review_threat_section "$1")" ]; then
    threats="The spec's analysis has a ### Threats section: $(review_analysis_path "$1") (when it has several, the last one). Read it, and check the diff against it: what it says is exposed, to whom, and what the change may do to it. Report each security finding as a defect with the file and line, why it is a risk (the input an attacker controls and what it reaches), and what would fix it."
  fi
  printf '%s\n' \
    "Read this spec's own description and everything this spec's branch changed, and look for defects: behaviour that is wrong, broken or missing against the description. Say nothing about stylistic preferences, naming or structure." \
    "" "Report a defect only when you can name the concrete case: the input or state, and the wrong result the code gives for it. A guard that might be missing, or a state the code cannot reach, is not a defect." \
    "" "An existing test the branch weakened is a defect too: one it deleted, one with an assertion removed or loosened, or one it marked as skipped or disabled. An existing test is one that was there where the branch left $3; one moved or renamed that still checks the same behaviour is not deleted. Its concrete case is the test and what it no longer checks. It is not a defect when the description replaces or removes the behaviour that test checked." \
    "" "The description: $1" \
    "" "What changed: run \`git diff $2\` in this directory, for every change since the branch left $3, committed or not, and \`git status --porcelain\` for new files not tracked yet. Read a whole file wherever the diff alone does not show enough."
  printf '%s\n' "" "$(review_design_instruction)"
  [ -n "$scope" ] && printf '%s\n' "" "$scope"
  checks="$(review_change_checks "${6:-}" "$2")"
  [ -n "$checks" ] && printf '%s\n' "" "This diff changes code that has had defects of its own kind before. Check it for each of these too; a change that breaks one is a defect, and say which:" "" "$checks"
  printf '%s\n' "" "When the description, or the spec's analysis, says this change fixes a security flaw, try the fix against at least one variant of that flaw — another input, path or caller reaching the same weakness — and report a variant the fix does not stop as a defect. Then read the code the fix touches as it stands now on $3 (\`git diff $2 $3 -- <path>\`, \`git show $3:<path>\`): report it as a defect when $3 has since gained another way to reach the flaw that the fix does not cover, or has changed code the fix relies on. The flaw itself still being there on $3 is expected, since the fix has not landed, and is not a defect."
  [ -n "$threats" ] && printf '%s\n' "" "$threats"
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
# against the code, and keep or drop it. With a <project-dir>, the
# change-specific checks the review was given are given here too.
verify_prompt() {  # <description-path> <fork> <base> <defects> <headless-note> [<project-dir>]
  local checks
  checks="$(review_change_checks "${6:-}" "$2")"
  printf '%s\n' \
    "A review of this spec's branch reported the defects below against the spec's own description and applicable project design rules. A review is often wrong. Check each one yourself in the code before anyone acts on it." \
    "" "Keep a defect only when you have traced a concrete case through the code: a state the code can reach, and the wrong result it gives there, against what the description or applicable project design rules require. Drop it when the code already handles the case, when the state cannot be reached, when it is only a guard that might be missing, or when neither the description nor the applicable project rules require what it says is missing." \
    "" "A defect about an existing test the branch weakened — one deleted, an assertion removed or loosened, or one marked as skipped or disabled — is checked on these terms instead: keep it when the diff shows the test weakened and the description does not replace or remove the behaviour that test checked. Drop it when the description replaces or removes that behaviour, or when the test was only moved or renamed and still checks the same behaviour." \
    "" "The description: $1" \
    "" "What changed: run \`git diff $2\` in this directory, for every change since the branch left $3, committed or not, and \`git status --porcelain\` for new files not tracked yet. Read a whole file wherever the diff alone does not show enough." \
    "" "$(review_design_instruction)"
  [ -n "$checks" ] && printf '%s\n' "" "The review was also given these checks, for code that has had defects of its own kind before. A defect that breaks one of them is kept on the same terms as one against the description:" "" "$checks"
  if [ -n "$(review_threat_section "$1")" ]; then
    printf '%s\n' "" "The spec's analysis has a ### Threats section: $(review_analysis_path "$1"). A security finding is required by it as much as by the description: keep one when you can trace the input that reaches the risk it names."
  fi
  printf '%s\n' \
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
