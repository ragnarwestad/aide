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
# rewrite it again afterwards. Git run in a worktree pinned here, with
# `-C <worktree>` or from inside it, gets the git directory recorded when
# the worktree was cut, so it never reads that file.
git_pinned_trees=()
git_pinned_dirs=()

# Records each worktree's git directory, resolved, as it is now; the
# worktree under both the name it was given and its resolved path.
git_pin_worktrees() {
  local wt dir real
  for wt in "$@"; do
    [ -f "$wt/.git" ] || continue
    dir="$(command git -C "$wt" rev-parse --absolute-git-dir 2>/dev/null)" || continue
    real="$(cd "$wt" && pwd -P)" || continue
    git_pinned_trees+=("$wt" "$real"); git_pinned_dirs+=("$dir" "$dir")
  done
}

# The pinned git directory for a worktree path, or nothing.
git_pinned_dir() {
  local i=0
  while [ "$i" -lt "${#git_pinned_trees[@]}" ]; do
    [ "${git_pinned_trees[$i]}" = "$1" ] && { printf '%s' "${git_pinned_dirs[$i]}"; return; }
    i=$((i + 1))
  done
}

git() {
  local dir
  if [ "${1:-}" = "-C" ]; then
    dir="$(git_pinned_dir "${2:-}")"
    if [ -n "$dir" ]; then
      command git -c core.hooksPath=/dev/null -C "$2" --git-dir="$dir" --work-tree="$2" "${@:3}"
      return
    fi
  else
    dir="$(git_pinned_dir "$PWD")"
    [ -n "$dir" ] || dir="$(git_pinned_dir "$(pwd -P)")"
    if [ -n "$dir" ]; then
      command git -c core.hooksPath=/dev/null --git-dir="$dir" --work-tree="$PWD" "$@"
      return
    fi
  fi
  command git -c core.hooksPath=/dev/null "$@"
}
