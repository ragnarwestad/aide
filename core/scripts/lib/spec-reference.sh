#!/usr/bin/env bash
# A spec's names, the runner's one copy: what a spec folder is, its branch,
# the keys a create and a scheduled job carry in place of a folder, the
# spec's own files, and the human-facing name of a numbered spec. The
# dashboard's copy is dashboard/src/project/spec-names.ts, and
# dashboard/test/project/spec-names.test.ts runs both on the same names.
# Machine-facing paths, branches, commits and record fields keep the
# complete folder name.

# The spec's own files, read by the runner's parts.
# shellcheck disable=SC2034
AIDE_DESCRIPTION_FILE="1-description.md"
# shellcheck disable=SC2034
AIDE_ANALYSIS_FILE="2-analysis.md"
# shellcheck disable=SC2034
AIDE_SOLUTION_FILE="3-solution.md"
# shellcheck disable=SC2034
AIDE_STATUS_FILE="4-status.md"
# shellcheck disable=SC2034
AIDE_STATE_FILE="4-status.json"
# shellcheck disable=SC2034
AIDE_AC_COVERAGE_FILE="ac-coverage.json"

# A numbered spec folder: digits, then a dash.
aide_is_spec_folder() { [[ "$1" =~ ^[0-9]+- ]]; }

# The branch a step pushes to, named for the spec's folder.
aide_spec_branch() { printf 'aide/%s' "$1"; }

# The key a create job carries until its merge names the spec. The dashboard
# makes it; the runner only recognises it.
aide_is_provisional_key() { [[ "$1" =~ ^new-[0-9a-f]{8}$ ]]; }

# The entry name inside a scheduled job's tracking key; any other key whole.
aide_schedule_name() { printf '%s' "${1#schedule-}"; }

aide_spec_reference() {
  local project="$1" folder="$2" number
  number="$(printf '%s' "$folder" | sed -n 's/^\([0-9][0-9]*\)\(-.*\)\{0,1\}$/\1/p')"
  [ -n "$number" ] || number="$folder"
  printf '%s:%s' "$project" "$number"
}

# --- a step's commit subject --------------------------------------------------
#
#     Run /aide-<step> for <spec-folder>[ (headless)][ (model: <tool> [<model>])][ (stopped: <reason>)]
#
# - `<step>` is the step's own name, exactly as `--command` names it.
# - `<spec-folder>` is the folder, never the numeric id: a `create` run
#   names the folder it just made.
# - ` (headless)` is present for a run `aide-run-spec` made and absent
#   for one committed at somebody's keyboard. Both count.
# - ` (model: <tool> [<model>])` says who ran the step. It comes before
#   the stop reason, which is read to the end of the subject.
# - ` (stopped: <reason>)` is present only when the run did NOT complete,
#   and carries `terminal_reason` verbatim. Such a step has RUN but is not
#   DONE.
# - Anything else with the same words in it — a revert, a merge, a subject
#   with more after it — is not a step. The match is the whole subject or
#   nothing.
#
# The dashboard reads the same subjects with parseStepSubject in
# dashboard/src/git/workflow-history.ts;
# dashboard/test/git/history/step-subject.test.ts runs both readers.
AIDE_STEP_SUBJECT_PREFIX="Run /aide-"

# The subject up to the folder: what a fixed-string `git log --grep` narrows on.
aide_step_subject_start() {   # <step> <folder>
  printf '%s%s for %s' "$AIDE_STEP_SUBJECT_PREFIX" "$1" "$2"
}

# The subject a headless step commits under. <notes> is the model and stop
# parts, already built (` (model: …)`, ` (stopped: …)`).
aide_step_subject() {   # <step> <folder> [<notes>]
  printf '%s (headless)%s' "$(aide_step_subject_start "$1" "$2")" "${3:-}"
}

# Whether <subject> is a step's subject for <folder>. Sets $subject_step,
# $subject_model and $subject_stop (empty when absent). The folder is
# compared as text, never put into a regex.
aide_read_step_subject() {   # <subject> <folder>
  local rest step re='^( \(headless\))?( \(model: ([^)]+)\))?( \(stopped: (.+)\))?$'
  subject_step=""; subject_model=""; subject_stop=""
  case "$1" in "$AIDE_STEP_SUBJECT_PREFIX"*) ;; *) return 1 ;; esac
  rest="${1#"$AIDE_STEP_SUBJECT_PREFIX"}"
  step="${rest%% for *}"
  [[ "$step" =~ ^[a-z][a-z-]*$ ]] || return 1
  rest="${rest#"$step for "}"
  case "$rest" in "$2"*) ;; *) return 1 ;; esac
  rest="${rest#"$2"}"
  [[ "$rest" =~ $re ]] || return 1
  subject_step="$step"
  subject_model="${BASH_REMATCH[3]}"
  subject_stop="${BASH_REMATCH[5]}"
}

# --- a spec's folder ------------------------------------------------------------

# The folder <id> names under <root>: the folder itself, else the first
# `<id>-*`. <where> is `active` (the default), `archive` (under
# <root>/archive) or `any` (active, then archive). Sets $found_folder (the
# folder's name) and $found_under (`` or `archive/`); fails, with both
# empty, when there is none or <id> is empty.
aide_find_spec_folder() {   # <root> <id> [<where>]
  local root="$1" id="$2" where="${3:-active}" under candidate base
  found_folder=""; found_under=""
  [ -n "$id" ] || return 1
  case "$where" in
    active) set -- "" ;;
    archive) set -- "archive/" ;;
    any) set -- "" "archive/" ;;
    *) return 1 ;;
  esac
  for under in "$@"; do
    [ -d "$root/${under%/}" ] || continue
    if [ -d "$root/$under$id" ]; then
      found_folder="$id"; found_under="$under"; return 0
    fi
    for candidate in "$root/$under"*/; do
      base="$(basename "$candidate")"
      case "$base" in "$id"-*) found_folder="$base"; found_under="$under"; return 0 ;; esac
    done
  done
  return 1
}
