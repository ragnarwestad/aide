#!/usr/bin/env bash
# Sourced by aide-resolve-test-cmd and aide-ac-prefix: which directory's
# `.aide/project.yaml` is a project's manifest.

# <dir> when it holds the manifest; otherwise, when <dir> is a worktree,
# the main checkout it belongs to; otherwise <dir> again.
# Usage: aide_manifest_root <dir>
aide_manifest_root() {
  local dir="$1" common
  if [ ! -f "$dir/.aide/project.yaml" ]; then
    common="$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
    case "$common" in */.git) dir="${common%/.git}" ;; esac
  fi
  printf '%s\n' "$dir"
}
