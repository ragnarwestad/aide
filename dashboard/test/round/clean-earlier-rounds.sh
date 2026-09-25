#!/usr/bin/env bash
# clean-earlier-rounds.sh — removes what earlier rounds left in the temp
# directory, sourced by `run` before it makes its own.
#
# A round's directory is recognised by what `run` puts in it (a queue
# config, the fixture specs' origin and the server's log), and it is left
# alone while any process still names it on its command line: a kept
# board and a test server the dashboard started both run `serve.ts` with
# `--root <dir>/root`. Anything else in the temp directory is not ours.

# clean_earlier_rounds <temp dir> <aide checkout>
clean_earlier_rounds() {
  local tmp="${1%/}" aide="$2" d running
  running="$(ps -axo command 2>/dev/null)"
  for d in "$tmp"/tmp.*; do
    [ -f "$d/queue-config.json" ] && [ -d "$d/specs-origin.git" ] && [ -f "$d/serve.log" ] || continue
    case "$running" in *"/$(basename "$d")/"*) continue ;; esac
    if [ -d "$d/checkout" ]; then
      git -C "$aide" worktree remove --force "$d/checkout" >/dev/null 2>&1 || true
    fi
    rm -rf "$d"
  done
  git -C "$aide" worktree prune >/dev/null 2>&1 || true
}
