#!/usr/bin/env bash
# run-spec/record/records.sh — the file that says how far a spec has come: where it is, when it changed, and which steps it names.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were. Also sourced by aide-record-step,
# which records a session's step with these same functions: the file stays
# function definitions only, and a function that reads a global names it.
# --- the record of what has run -----------------------------------
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
# The subject's grammar is written once, beside its reader and writer in
# lib/spec-reference.sh (`aide_read_step_subject`). What this file adds
# is which commit speaks for a step:
#
# - The newest commit for a step is the one that speaks for it: a
#   re-run supersedes whatever the attempt before it said.
# - A completed `analyze` is newer than every `implement` and `archive`
#   before it, and those no longer count: the plan they were made from
#   has been replaced. The log is read newest first (`--date-order`, so a
#   commit is never listed before one made on top of it), and an
#   `implement` or `archive` below a completed `analyze` is skipped. A
#   stopped `analyze` supersedes nothing. The twin
#   (dashboard/src/git/workflow-history.ts) spells the steps as
#   the ones after `analyze` in `HISTORY_STEPS`; this side spells them
#   out (`implement|archive`), so a change to the arc has to touch both.
#
# The four values the line may name are the workflow's own stages
# (`WORKFLOW_ARC`, read at the top of this script from
# workflow-steps.json), and deliberately not the ten steps this script
# will run: `explore` is a thing you can queue, not a place
# a spec gets to. `WORKFLOW_ARC_RETIRED` is a step name retired FROM the
# arc, kept recognized here when READING old commits ("every archived
# spec whose history contains
# a review-plan run still displays that history") — `completed_steps_for`
# below has to keep recognizing it or an archived spec's history silently
# loses a step it actually had.

# Where the spec's `4-status.md` is in the specs worktree RIGHT NOW. An
# archive step's own `git mv` has already moved the folder by the time
# this runs, so `archive/` is tried too (`aide_find_spec_folder`, any).
status_file_for() {   # sets $status_file
  local folder="$1"
  status_file=""
  aide_find_spec_folder "$specs_root_wt" "$folder" any \
    && [ -f "$specs_root_wt/$found_under$found_folder/${AIDE_STATUS_FILE}" ] \
    && status_file="$specs_root_wt/$found_under$found_folder/${AIDE_STATUS_FILE}"
  return 0
}

# Where THIS step's own artifact is — the folder found as `status_file_for`
# above finds it (active, then archive/), and the file each phase owns
# rather than 4-status.md alone.
phase_file_for() {   # sets $phase_file
  local step="$1" folder="$2" name=""
  phase_file=""
  case "$step" in
    create)    name="${AIDE_DESCRIPTION_FILE}" ;;
    analyze)   name="${AIDE_ANALYSIS_FILE}" ;;
    implement) name="${AIDE_SOLUTION_FILE}" ;;
    archive)   name="${AIDE_STATUS_FILE}" ;;
  esac
  [ -n "$name" ] || return 0
  aide_find_spec_folder "$specs_root_wt" "$folder" any \
    && [ -f "$specs_root_wt/$found_under$found_folder/$name" ] \
    && phase_file="$specs_root_wt/$found_under$found_folder/$name"
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
# Where a reopened spec's history STARTS. An archived spec
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
  # shellcheck disable=SC2016  # the backticks are markdown, matched as they are
  work_round_sha="$(sed -n \
    -e 's/^[[:space:]]*-\{0,1\}[[:space:]]*\*\*Reopened:\*\*.*history before `\([0-9a-fA-F]\{7,40\}\)`.*/\1/p' \
    -e 's/^[[:space:]]*-\{0,1\}[[:space:]]*\*\*Reset:\*\*.*history before `\([0-9a-fA-F]\{7,40\}\)`.*/\1/p' \
    "$file" 2>/dev/null | tail -1)"
  return 0
}

# The sha of the `**Round boundary:**` a keep-Reopen stamped, when this
# spec is in the round that stamp opened (sets $kept_round_sha). That is:
# an `**Archived:**` or `**Closed:**` stamp is followed by a
# `**Round boundary:**` line with no `**Reopened:**`/`**Reset:**` mark or
# newer stamp in between. A spec that was never reopened, one reopened WITH
# reset, or one archived again since, answers nothing. Same order rule as
# spec-state.sh's live stamps and discover/spec-files.ts.
kept_round_boundary_in() {   # sets $kept_round_sha
  local file="$1"
  kept_round_sha=""
  [ -f "$file" ] || return 0
  # shellcheck disable=SC2016  # the backticks are markdown, matched as they are
  kept_round_sha="$(awk '
    { line = $0; sub(/^[[:space:]]*-?[[:space:]]*/, "", line) }
    index(line, "**Archived:**") == 1 || index(line, "**Closed:**") == 1 { stamped = 1; sha = ""; next }
    index(line, "**Reopened:**") == 1 || index(line, "**Reset:**") == 1 { stamped = 0; sha = ""; next }
    index(line, "**Round boundary:**") == 1 && stamped {
      if (match(line, /history before `[0-9a-fA-F]+`/)) {
        sha = substr(line, RSTART + 16, RLENGTH - 17)
      }
    }
    END { if (stamped && sha != "") print sha }
  ' "$file" 2>/dev/null | tail -1)"
  return 0
}

# Whether the spec stood at `implemented` before this step's session: its
# state at the pre-session ref, read the way the gates read it.
analysis_follows_implement() {   # $1 = status file, $2 = pre-session ref
  local state_json="" state_json_found=""
  [ -n "${2:-}" ] || return 1
  read_spec_state_at_ref "$(dirname "$1")" "$2" "$(basename "$1")"
  [ "$state_json_found" = "yes" ] || return 1
  [ "$(current_phase_from "$state_json")" = "implemented" ]
}

# After a completed analysis: every acceptance row `Not verified` when the
# description says `Acceptance: not required`, else every row open when the
# spec stood at `implemented` before the session (the code the ticks judged
# is about to be replaced). Needs rebuild_acceptance_rows from
# spec-transitions.sh.
rebuild_acceptance_after_analysis() {   # $1 = status file, $2 = pre-session ref
  local status_file="$1" description
  description="$(dirname "$status_file")/${AIDE_DESCRIPTION_FILE}"
  if grep -Eq '^[[:blank:]]*-[[:blank:]]*\*\*Acceptance:\*\*[[:blank:]]*not required[[:blank:]]*$' \
     "$description" 2>/dev/null; then
    rebuild_acceptance_rows "$status_file" "$description" "Not verified"
  elif analysis_follows_implement "$status_file" "${2:-}"; then
    rebuild_acceptance_rows "$status_file" "$description"
  fi
  return 0
}

completed_steps_for() {   # sets $completed_steps; reads $command_name, $terminal_reason, $WORKFLOW_ARC, $WORKFLOW_ARC_RETIRED
  local folder="$1" dir="$2" subject step reason seen completed
  local existing_line existing_step archive_counts="yes"
  local analyzed_since="" reset_by_this_run=""
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
  # A keep-Reopen leaves the earlier round's `archive` commit in reach of
  # the scan below (its boundary cannot be `--not`, which would cut every
  # earlier step the reopen KEPT). `archive` alone counts only from a
  # commit made after the round boundary.
  kept_round_boundary_in "$3"
  if [ -n "$kept_round_sha" ]; then
    archive_counts=""
    while IFS= read -r subject; do
      aide_read_step_subject "$subject" "$folder" && [ "$subject_step" = "archive" ] || continue
      [ -n "$subject_stop" ] || { archive_counts="yes"; break; }
    done <<ARCHIVE_SCAN
$(git -C "$dir" log --all --not "$kept_round_sha" --format=%s --fixed-strings \
    --grep="$(aide_step_subject_start archive "$folder")" 2>/dev/null)
ARCHIVE_SCAN
  fi
  seen="|"; completed="|"
  case " $WORKFLOW_ARC " in
    *" $command_name "*)
      seen="|$command_name|"
      if [ "$terminal_reason" = "completed" ]; then
        completed="|$command_name|"
        # A completed analyze cancels the implement and archive before it.
        [ "$command_name" = "analyze" ] && { analyzed_since="yes"; reset_by_this_run="yes"; }
      fi
      ;;
  esac
  # --all, not HEAD: `implement` deliberately lands nothing until
  # `archive` runs, so its commit sits on this spec's own branch for as
  # long as the spec takes. Newest first, which is what makes the first
  # sighting of a step the one that speaks for it — and `--date-order`
  # keeps it so: without it a commit dated earlier than the one it was
  # made on top of can be listed after it, and an implement would read as
  # newer than the analysis above it.
  while IFS= read -r subject; do
    [ -n "$subject" ] || continue
    aide_read_step_subject "$subject" "$folder" || continue
    step="$subject_step"
    reason="$subject_stop"
    case " $WORKFLOW_ARC $WORKFLOW_ARC_RETIRED " in *" $step "*) ;; *) continue ;; esac
    # Newest first: everything below a completed analyze is older than it.
    [ "$step" = "analyze" ] && [ -z "$reason" ] && analyzed_since="yes"
    case "$step" in implement|archive) [ -n "$analyzed_since" ] && continue ;; esac
    [ "$step" = "archive" ] && [ -z "$archive_counts" ] && continue
    case "$seen" in *"|$step|"*) continue ;; esac
    seen="$seen$step|"
    [ -n "$reason" ] || completed="$completed$step|"
  done <<EOF
$(git -C "$dir" log --all --date-order ${boundary_args[@]+"${boundary_args[@]}"} --format=%s --fixed-strings \
    --grep="$AIDE_STEP_SUBJECT_PREFIX" --grep=" for $folder" --all-match 2>/dev/null)
EOF
  # A step the line already names stays named, whatever the scan found
  # The scan sees a step only through the commit-subject
  # grammar, and a step that committed its own work under a descriptive
  # subject is invisible to it — an earlier `implement` committed as
  # "Record the implementation of ...", and the next step's recompute
  # wrote `analyze, archive` over `analyze, implement`, which is the only
  # record there is that implement ran. So the line is a THIRD source
  # here, alongside this run's own outcome and the scan: added to, never
  # subtracted from. Two places take a step off it: `aide-reopen`, which
  # regenerates `4-status.md` without the line at all, and this run's own
  # completed analyze, which takes `implement` and `archive` off (below).
  # No other run subtracts: a step committed under a descriptive subject
  # is the case this source exists for, and a later run cannot tell it
  # from a step a new analysis has cancelled.
  #
  # Tokens are filtered through the same arc lists the scan filters
  # through, so a placeholder or a typo left on the line by hand does not
  # become permanent. Splitting is comma -> space, then ordinary word
  # splitting: bash 3.2 has no `mapfile`, and BSD `sed` will not put a
  # newline in a replacement.
  #
  # Read the line as it stood BEFORE this step's own session
  # ran ($4, the specs worktree's pre-session ref), not the file's
  # current content — otherwise a session that writes a LATER step's
  # name into its own assembled text grants itself permanent credit for
  # that step, since this function never subtracts (by design,
  # for a different case: a step that committed its own work under a
  # descriptive subject, invisible to the scan above). The fallback to
  # today's post-session read covers the one case with no "before" to
  # read from: a brand-new spec's `4-status.md`, which does not exist at
  # `$4` yet.
  if [ -n "${4:-}" ] && \
     existing_line="$(git -C "$2" show "$4:./$(basename "$3")" 2>/dev/null | workflow_steps_in)"; then
    :
  else
    existing_line="$(workflow_steps_in "$3")"
  fi
  for existing_step in $existing_line; do
    [ "$existing_step" = "archive" ] && [ -z "$archive_counts" ] && continue
    case "$existing_step" in implement|archive) [ -n "$reset_by_this_run" ] && continue ;; esac
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
