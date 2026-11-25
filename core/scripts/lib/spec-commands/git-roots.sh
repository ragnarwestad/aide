#!/usr/bin/env bash
# The check aide-install-spec-hook and aide-pull-specs make on each repo
# path they are given, before they touch it.

# Fails, saying on stderr why the repo is skipped, when <root> is not a
# directory or not a git working tree.
aide_usable_git_root() {   # <root>
  local name
  name="$(basename "$1")"
  if [ ! -d "$1" ]; then
    echo "$name: skipped — no such directory: $1" >&2
    return 1
  fi
  if ! git -C "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "$name: skipped — not a git working tree" >&2
    return 1
  fi
}
