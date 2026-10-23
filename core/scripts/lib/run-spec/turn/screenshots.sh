#!/usr/bin/env bash
# run-spec/turn/screenshots.sh — the screenshots an implement leaves of the
# pages its branch changed, in Aide's own repository only.
#
# A change to how the dashboard looks passes its tests and the review of the
# diff and can still look wrong. So the implement skill's Step 4 has the
# session serve the worktree on throwaway data, photograph the pages it
# changed at a desktop and a phone width (dashboard/scripts/look-at-pages.ts),
# look at them and fix what is wrong. The runner's part is here: it names a
# folder beside the step's log, empties it before the turn, settles after the
# turn what the folder holds (logs it, or logs why it holds nothing), and
# hands the pictures to the review.
#
# Functions only; sourced by aide-run-spec after run-spec/checkout/branch.sh
# and before run-spec/turn/spec-paths.sh, which builds the prompt while it is
# sourced. Reads command_name, project_wt, stream_file and work_dir.

# True for an implement in a repository that carries the script: the sign of
# Aide's own repository. Every other project gets nothing from this file.
screenshots_wanted() {
  [ "$command_name" = "implement" ] && [ -f "$project_wt/dashboard/scripts/look-at-pages.ts" ]
}

# Beside the step's log, kept with it; a run with no stream file keeps
# nothing, so its folder goes with the run.
screenshots_dir() {
  if [ -n "${stream_file:-}" ]; then
    printf '%s' "${stream_file%.stream.jsonl}.screenshots"
  else
    printf '%s' "$work_dir/screenshots"
  fi
}

# What the implement prompt gains: empty unless the project is Aide's own.
screenshots_prompt_line() {
  screenshots_wanted || return 0
  local dir
  dir="$(screenshots_dir)"
  printf '%s' "If this spec's branch changes a file under dashboard/src/render/ or a stylesheet, compared with the default branch, look at the pages it changes as the implement skill's Step 4 says, and leave the final screenshots in $dir. If you cannot take them, write one sentence saying why to $dir/not-taken.txt."
}

# True when the branch's changes since <fork>, committed or not, include a
# file under dashboard/src/render/ or a stylesheet.
screenshots_called_for() {  # <fork>
  screenshots_wanted || return 1
  {
    git -C "$project_wt" diff --name-only "$1" 2>/dev/null
    git -C "$project_wt" status --porcelain 2>/dev/null | sed 's/^...//'
  } | grep -qE '^(dashboard/src/render/|.*\.css$)'
}

screenshots_count() {
  find "$(screenshots_dir)" -maxdepth 1 -name '*.png' 2>/dev/null | wc -l | tr -d ' '
}

# Once after an implement turn that ended completed, before the review. A
# branch that changes no page keeps no folder; one that does logs what the
# folder holds, or why it holds nothing. The step goes on either way.
screenshots_settle() {  # <fork>
  screenshots_wanted || return 0
  local dir count note
  dir="$(screenshots_dir)"
  if ! screenshots_called_for "$1"; then
    rm -rf "$dir"
    return 0
  fi
  count="$(screenshots_count)"
  note=""
  if [ -s "$dir/not-taken.txt" ]; then
    note="$(head -c 400 "$dir/not-taken.txt" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  fi
  if [ "$count" -gt 0 ]; then
    stage "screenshots: $count of the changed pages, kept with the step's logs"
    [ -n "$note" ] && stage_error "not all the changed pages were looked at: $note"
  else
    stage_error "the changed pages were not looked at: ${note:-no screenshots and no reason were left} — proceeding without them"
  fi
  return 0
}

# The review's and the fix turn's lines: empty unless the settled folder
# holds a picture.
screenshots_review_line() {
  screenshots_wanted || return 0
  [ "$(screenshots_count)" -gt 0 ] || return 0
  printf '%s' "Screenshots of the pages this change affects, each at 1440 px and 390 px wide, are in $(screenshots_dir). Look at every one beside the diff, against the description and dashboard/docs/design-system.md. What looks wrong on them, its placement and styling included, is a defect too."
}

screenshots_fix_line() {
  screenshots_wanted || return 0
  [ "$(screenshots_count)" -gt 0 ] || return 0
  printf '%s' "If a fix changes how a page looks, take its screenshots again into $(screenshots_dir), as the implement skill's Step 4 says."
}
