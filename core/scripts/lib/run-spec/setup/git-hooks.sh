#!/usr/bin/env bash
# run-spec/setup/git-hooks.sh — sourced by aide-run-spec before anything
# that runs git.
#
# The runner's own git runs no hooks, and finds a worktree's git directory
# where it was when the worktree was cut. Every `git` in this script and
# the files it sources is this function. It is not exported, so what the
# runner starts — the AI tool, the project's test command, the spec
# scripts — runs git as it would anywhere else.
#
# No hooks: a hook is a program git starts by itself, and the runner runs
# git outside the sandbox, after a step has written to the working tree; a
# hook that reads the working tree (a relative `core.hooksPath`,
# lefthook's `lefthook.yml`) would run what the step wrote. The landing
# does the same in `NO_GIT_HOOKS` (dashboard/src/integrations/no-git-hooks.ts).
#
# The git directory: a worktree's `.git` file says where its git directory
# is, and the step can write it. The runner puts it back after every turn
# (`sandbox_restore_git_links`), but a process the step left running could
# rewrite it again afterwards. `git -C <worktree>` for a worktree pinned
# here passes the git directory recorded when it was cut, so git never
# reads that file.
git_pinned_trees=()
git_pinned_dirs=()

# Records each worktree's git directory, resolved, as it is now.
git_pin_worktrees() {
  local wt dir
  for wt in "$@"; do
    [ -f "$wt/.git" ] || continue
    dir="$(command git -C "$wt" rev-parse --absolute-git-dir 2>/dev/null)" || continue
    git_pinned_trees+=("$wt"); git_pinned_dirs+=("$dir")
  done
}

git() {
  local i=0
  if [ "${1:-}" = "-C" ]; then
    while [ "$i" -lt "${#git_pinned_trees[@]}" ]; do
      if [ "${git_pinned_trees[$i]}" = "${2:-}" ]; then
        command git -c core.hooksPath=/dev/null -C "$2" \
          --git-dir="${git_pinned_dirs[$i]}" --work-tree="$2" "${@:3}"
        return
      fi
      i=$((i + 1))
    done
  fi
  command git -c core.hooksPath=/dev/null "$@"
}
