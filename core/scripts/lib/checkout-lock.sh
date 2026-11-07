#!/usr/bin/env bash
# The lock every move of a shared checkout runs under: the pull, the
# worktree add, the commit on a Cancel. Runs of one project share its
# checkout, and a git command that moves it outside the lock loses a ref
# lock or the checkout under its feet. Sourced by aide-run-spec and
# aide-preview.
#
# The lock is a directory, made with mkdir, holding the owner's pid. A
# waiter that finds the owner's pid gone takes the lock over: a killed
# run never released it.

# $1 = a checkout. The lock's path in it.
checkout_lock_path() {
  printf '%s/.git/aide-run-spec-worktree.lock\n' "$1"
}

# $1 = a checkout, $2 = how many seconds to wait. Takes the lock and
# returns 0, or returns 1 when the wait ran out. Sets $checkout_lock_owner
# to the pid that held it last, for the sentence a caller writes.
checkout_lock_take() {
  local lock deadline
  lock="$(checkout_lock_path "$1")"
  deadline=$(( $(date +%s) + $2 ))
  checkout_lock_owner=""
  while ! mkdir "$lock" 2>/dev/null; do
    checkout_lock_owner="$(cat "$lock/pid" 2>/dev/null || true)"
    if [ -n "$checkout_lock_owner" ] && ! kill -0 "$checkout_lock_owner" 2>/dev/null; then
      rm -rf "$lock" 2>/dev/null || true
      continue
    fi
    [ "$(date +%s)" -ge "$deadline" ] && return 1
    sleep 0.2
  done
  echo $$ > "$lock/pid" 2>/dev/null || true
  return 0
}
