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
