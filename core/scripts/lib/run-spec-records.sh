#!/usr/bin/env bash
# run-spec-records.sh — the file that says how far a spec has come: where it is, when it changed, and which steps it names.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were.
# --- the record of what has run (spec 154) -----------------------------------
# The dashboard reads this spec's own commits to decide which steps it
# has had. Everything that is not the dashboard — a person opening the
# raw markdown, aide-generate-pdf, the /projects page — reads
# `4-status.md`. So the file's own line is written HERE, from the same
# commits, and the file agrees with git by construction: a step killed
# before the model reached its last instruction does not leave the line
# stale, and a `4-status.md` copied from a sibling is corrected by the
# first step that runs on it.
#
# Written BEFORE the commit loop below, never after: the loop's own
# commit is what has to carry this edit, and `head_after_per_root` — the
# obvious thing to key it on — is not known until that commit has been
# made. So the edit goes in first and the existing `add -A` picks it up.
#
# THIS BLOCK IS COPIED VERBATIM from `dashboard/src/workflow-history.ts`,
# which derives the same answer in TypeScript for the live page. Two
# implementations of one rule, in two languages, the way WORKFLOW_STEPS
# and DEPENDENCY_GATED_STEPS already are — change one and the other has
# to change with it.
#
#     Run /aide-<step> for <spec-folder>[ (headless)][ (stopped: <reason>)]
#
# - `<step>` is the step's own name, exactly as `--command` names it.
# - `<spec-folder>` is the folder, never the numeric id: a `create` run
#   names the folder it just made.
# - ` (headless)` is present for a run `aide-run-spec` made and absent
#   for one committed at somebody's keyboard. Both count.
# - ` (stopped: <reason>)` is present only when the run did NOT
#   complete, and carries `terminal_reason` verbatim (`timeout`,
#   `budget_exhausted`, …). Such a step has RUN but is not DONE.
# - The newest commit for a step is the one that speaks for it: a
#   re-run supersedes whatever the attempt before it said.
# - Anything else with the same words in it — a revert, a merge, a
#   subject with more after it — is not a step. The match is the whole
#   subject or nothing.
#
# The four values the line may name are the workflow's own stages
# (`WORKFLOW_ARC`, read at the top of this script from
# workflow-steps.json), and deliberately not the nine steps this script
# will run: `explore` and `manifest` are things you can queue, not places
# a spec gets to. `WORKFLOW_ARC_RETIRED` is a step name retired FROM the
# arc, kept recognized here when READING old commits (spec 181,
# description requirement 2: "every archived spec whose history contains
# a review-plan run still displays that history") — `completed_steps_for`
# below has to keep recognizing it or an archived spec's history silently
# loses a step it actually had.

# Where the spec's `4-status.md` is in the specs worktree RIGHT NOW. An
# archive step's own `git mv` has already moved the folder by the time
# this runs, so `archive/` is tried too — the same two-step resolution
# `resolve_dependency_folder` does for a dependency.
status_file_for() {   # sets $status_file
  local folder="$1"
  status_file=""
  [ -n "$folder" ] || return 0
  if [ -f "$specs_root_wt/$folder/4-status.md" ]; then
    status_file="$specs_root_wt/$folder/4-status.md"
  elif [ -f "$specs_root_wt/archive/$folder/4-status.md" ]; then
    status_file="$specs_root_wt/archive/$folder/4-status.md"
  fi
  return 0
}

# Where THIS step's own artifact is (spec 245) — the same two-candidate
# (active folder, then archive/) resolution `status_file_for` above
# already does, generalized to the file each phase owns rather than
# 4-status.md alone.
phase_file_for() {   # sets $phase_file
  local step="$1" folder="$2" name=""
  phase_file=""
  case "$step" in
    create)    name="1-description.md" ;;
    analyze)   name="2-analysis.md" ;;
    implement) name="3-solution.md" ;;
    archive)   name="4-status.md" ;;
  esac
  [ -n "$name" ] && [ -n "$folder" ] || return 0
  if [ -f "$specs_root_wt/$folder/$name" ]; then
    phase_file="$specs_root_wt/$folder/$name"
  elif [ -f "$specs_root_wt/archive/$folder/$name" ]; then
    phase_file="$specs_root_wt/archive/$folder/$name"
  fi
  return 0
}

# Which of the file's OWN, already-model-written date fields gets its
# time of day filled in by this step — never a new field. The
# description is explicit about this for `create` ("the date already
# exists as `Created:` — only the time of day is new"), and the same
# shape holds for every other phase's own date field too.
date_field_for() {
  case "$1" in
    create) printf 'Created' ;;
    analyze) printf 'Last analyzed' ;;
    implement|archive) printf 'Last updated' ;;
  esac
}

# The steps this spec has COMPLETED, in workflow order, as a comma
# separated list. This run's own outcome is known directly and is
# recorded first, so it wins over anything the log says about the same
# step — its commit does not exist yet.
# Where a reopened spec's history STARTS (spec 198). An archived spec
# that has to be done again keeps every commit from the earlier round —
# they happened, and the archive is a record — so what changes is not the
# repository but what counts. The mark is one line of the spec's own
# `4-status.md`, beside the `**Archived:**` stamp it keeps:
#
#     - **Reopened:** 2026-08-23 (history before `1d0fe79` does not count)
#
# One grammar, four readers: this, `parse-status.ts`,
# `workflow-history.ts` and `description-freshness.ts`. The LAST mark
# wins — a spec reopened twice counts from its current round — and a mark
# with no sha in it is not a boundary at all: an unreadable one says
# nothing, which is the pre-reopen behaviour, where a guessed one would
# hide a round that really did run.
work_round_boundary_in() {   # sets $work_round_sha
  local file="$1"
  work_round_sha=""
  [ -f "$file" ] || return 0
  work_round_sha="$(sed -n \
    -e 's/^[[:space:]]*-\{0,1\}[[:space:]]*\*\*Reopened:\*\*.*history before `\([0-9a-fA-F]\{7,40\}\)`.*/\1/p' \
    -e 's/^[[:space:]]*-\{0,1\}[[:space:]]*\*\*Reset:\*\*.*history before `\([0-9a-fA-F]\{7,40\}\)`.*/\1/p' \
    "$file" 2>/dev/null | tail -1)"
  return 0
}

completed_steps_for() {   # sets $completed_steps
  local folder="$1" dir="$2" subject step reason seen completed re
  local existing_line existing_step
  local boundary_args=()
  completed_steps=""
  # `--not <sha>` excludes every commit REACHABLE from the mark — exactly
  # the earlier round, since the mark is the specs repo's default-branch
  # tip at the moment of reopening and the earlier round's commits were
  # landed onto that branch by its own archive step. A commit made AFTER
  # the mark is a descendant, never an ancestor, so the new round is
  # untouched. It has to FOLLOW `--all`: `--not` alone names no positive
  # rev, and git then walks nothing at all.
  work_round_boundary_in "$3"
  [ -n "$work_round_sha" ] && boundary_args=(--not "$work_round_sha")
  seen="|"; completed="|"
  case " $WORKFLOW_ARC " in
    *" $command_name "*)
      seen="|$command_name|"
      [ "$terminal_reason" = "completed" ] && completed="|$command_name|"
      ;;
  esac
  re="^Run /aide-([a-z][a-z-]*) for ${folder}( \(headless\))?( \(model: ([^)]+)\))?( \(stopped: (.+)\))?$"
  # --all, not HEAD: `implement` deliberately lands nothing until
  # `archive` runs, so its commit sits on this spec's own branch for as
  # long as the spec takes. Newest first, which is what makes the first
  # sighting of a step the one that speaks for it.
  while IFS= read -r subject; do
    [ -n "$subject" ] || continue
    [[ "$subject" =~ $re ]] || continue
    step="${BASH_REMATCH[1]}"
    reason="${BASH_REMATCH[6]}"
    case " $WORKFLOW_ARC $WORKFLOW_ARC_RETIRED " in *" $step "*) ;; *) continue ;; esac
    case "$seen" in *"|$step|"*) continue ;; esac
    seen="$seen$step|"
    [ -n "$reason" ] || completed="$completed$step|"
  done <<EOF
$(git -C "$dir" log --all ${boundary_args[@]+"${boundary_args[@]}"} --format=%s --fixed-strings \
    --grep="Run /aide-" --grep=" for $folder" --all-match 2>/dev/null)
EOF
  # A step the line already names stays named, whatever the scan found
  # (spec 214). The scan sees a step only through the commit-subject
  # grammar, and a step that committed its own work under a descriptive
  # subject is invisible to it — Woodstack 22's `implement` committed as
  # "Record the implementation of ...", and the next step's recompute
  # wrote `analyze, archive` over `analyze, implement`, which is the only
  # record there is that implement ran. So the line is a THIRD source
  # here, alongside this run's own outcome and the scan: added to, never
  # subtracted from. `aide-reopen` is the one place a step comes off it,
  # and it does that by regenerating `4-status.md` without the line at
  # all — so there is nothing here to special-case.
  #
  # Tokens are filtered through the same arc lists the scan filters
  # through, so a placeholder or a typo left on the line by hand does not
  # become permanent. Splitting is comma -> space, then ordinary word
  # splitting: bash 3.2 has no `mapfile`, and BSD `sed` will not put a
  # newline in a replacement.
  #
  # spec 288: read the line as it stood BEFORE this step's own session
  # ran ($4, the specs worktree's pre-session ref), not the file's
  # current content — otherwise a session that writes a LATER step's
  # name into its own assembled text grants itself permanent credit for
  # that step, since this function never subtracts (spec 214, by design,
  # for a different case: a step that committed its own work under a
  # descriptive subject, invisible to the scan above). The fallback to
  # today's post-session read covers the one case with no "before" to
  # read from: a brand-new spec's `4-status.md`, which does not exist at
  # `$4` yet.
  if [ -n "${4:-}" ] && \
     existing_line="$(git -C "$2" show "$4:./$(basename "$3")" 2>/dev/null | \
       sed -n 's/^- \*\*Workflow steps completed:\*\*//p' | tail -1)"; then
    :
  else
    existing_line="$(sed -n 's/^- \*\*Workflow steps completed:\*\*//p' "$3" 2>/dev/null | tail -1)"
  fi
  for existing_step in $(printf '%s' "$existing_line" | tr ',' ' '); do
    case " $WORKFLOW_ARC $WORKFLOW_ARC_RETIRED " in
      *" $existing_step "*) completed="$completed$existing_step|" ;;
    esac
  done
  for step in $WORKFLOW_ARC $WORKFLOW_ARC_RETIRED; do
    case "$completed" in
      *"|$step|"*) completed_steps="${completed_steps:+$completed_steps, }$step" ;;
    esac
  done
  return 0
}
