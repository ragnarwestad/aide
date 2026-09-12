#!/usr/bin/env bash
# run-spec-gates.sh — the refusals that come before any AI is spent.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were. Split out 2026-09-04: the
# script had reached 2925 lines, five times the next largest file in
# the repo, and no reader could hold it.
# --- refuse while a spec this one depends on is still unmerged ---------------
# A spec can name the specs it builds on (a "Depends on:" line in its
# 1-description.md, spec 92). Every run cuts its branch from origin/$base
# in a fresh worktree, so a spec started while one it depends on is still
# unmerged is analyzed and implemented against a main that does not
# contain it — a merge conflict later at best, and at worst work built on
# old code that nobody notices until someone reads the diff.
#
# For the steps that BUILD on that code, and no others (spec 122): see
# DEPENDENCY_GATED_STEPS. A queue that can wait parks such a job instead
# of ever reaching this refusal; a run started by hand still gets it,
# because there is no scheduler there to park it against.
#
# The whole block sits AFTER roots is complete (the check needs them) and
# BEFORE anything touches a checkout, so a refusal here leaves nothing
# behind.

# Mirrors the --spec resolver above (direct match, then <id>-*), plus one
# deliberate addition: the archive, so a dependency's folder NAME resolves
# whichever list it is currently under. Reaching for the shared library's
# aide_resolve_spec instead would give --spec and "Depends on:" two
# different ideas of a valid identifier inside one script.
#
# Resolves a folder NAME only (spec 351) — whether that folder is done is
# no longer this function's question. A local directory listing cannot
# answer it: this checkout may not have pulled since the dependency's
# `archive` step landed on origin (REQ-2), so the LOCAL archive/ scan
# below is a hint for resolving the name, never proof of being done.
resolve_dependency_folder() {   # sets $dep_folder
  local id="$1" candidate base
  dep_folder=""
  [ -n "$id" ] || return 0
  if [ -d "$specs_root/$id" ]; then
    dep_folder="$id"; return 0
  fi
  for candidate in "$specs_root"/*/; do
    base="$(basename "$candidate")"
    case "$base" in "$id"-*) dep_folder="$base"; return 0 ;; esac
  done
  [ -d "$specs_root/archive" ] || return 0
  for candidate in "$specs_root/archive"/*/; do
    base="$(basename "$candidate")"
    case "$base" in "$id" | "$id"-*) dep_folder="$base"; return 0 ;; esac
  done
}

# ls-remote, not fetch: it ASKS origin rather than believing this
# checkout's remote-tracking refs, which keep a merged-and-deleted branch
# around until somebody prunes — and a stale ref would refuse every run
# for a dependency that landed weeks ago. It also writes nothing, which
# is what a guard placed before the dirty-tree check should do.
#
# Best-effort, like every other network call in this script (see --pull):
# an origin that cannot be reached is not itself a reason to refuse, so
# the run proceeds exactly as it would have before this guard existed.
# The default branch, not whatever a previous run left checked out. A
# job that started on the last job's spec branch would pull that branch
# (whose upstream may be gone after a merge) and base its work on stale
# code. Measured 2026-08-16: exactly that refused a run.
default_branch() {
  local root="$1" ref
  ref="$(git -C "$root" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)"
  if [ -n "$ref" ]; then
    echo "${ref#origin/}"
    return
  fi
  for candidate in main master; do
    git -C "$root" show-ref --verify --quiet "refs/heads/$candidate" && { echo "$candidate"; return; }
  done
  git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null
}

# True (rc 0) unless origin can PROVE $1's folder is not (yet) under
# archive/ in the specs repo's current default branch — the question
# REQ-1 asks (spec 351), replacing the branch-merge question this
# function used to ask: a branch with no commits beyond origin, or no
# branch pushed at all, both used to read as "merged," and a dependency
# mid-workflow with nothing currently pushed is neither done nor
# equivalent to one that is (the 340/341 incident this spec exists for).
#
# Asked against $specs_root alone, never the project root: whether a
# spec is archived is a fact about one folder's location in one
# repository, unlike a code branch which can differ per repo.
#
# Reuses the private-ref idiom the old function established (a stale
# refs/remotes/origin/* survives a delete until pruned); the cwd-relative
# `./` path (gitrevisions(7)) reads the tree at $specs_root's own
# position inside its repository without computing that prefix by hand.
#
# Fail-open like every other network call in this script: an unreachable
# origin answers "not confirmed either way," and only a REACHED origin
# that plainly does not have the folder refuses — this now runs for
# EVERY dependency, archived or not (REQ-2), so a locally-known-archived
# dependency pays one more fetch than it used to.
dependency_archived_on_origin() {
  local dep_folder="$1" base found
  base="$(default_branch "$specs_root")"
  git -C "$specs_root" fetch -q origin "refs/heads/$base:refs/aide-dep/base" \
    >/dev/null 2>&1 || return 0
  git -C "$specs_root" cat-file -e "refs/aide-dep/base:./archive/$dep_folder" 2>/dev/null
  found=$?
  git -C "$specs_root" update-ref -d refs/aide-dep/base >/dev/null 2>&1 || true
  return $found
}

# Only the LOOP is gated on the command, never the three functions above
# it: `default_branch` is called unconditionally four more times further
# down, so gating its definition would leave every non-gated command
# calling a function that does not exist.
#
# Guarded like every other library call here: the library is sourced
# conditionally, and an unguarded call would silently no-op under
# `set -uo pipefail` rather than failing loudly.
case " $DEPENDENCY_GATED_STEPS " in
  *" $command_name "*)
    if declare -f aide_spec_dependencies >/dev/null 2>&1; then
      for dep_id in $(aide_spec_dependencies "$specs_root" "$spec_folder"); do
        resolve_dependency_folder "$dep_id"
        [ -n "$dep_folder" ] \
          || refuse "Spec $spec_folder depends on an unknown spec: $dep_id (not under $specs_root)"
        [ "$dep_folder" = "$spec_folder" ] \
          && refuse "Spec $spec_folder cannot depend on itself ($dep_id)"
        dependency_archived_on_origin "$dep_folder" \
          || refuse "Spec $spec_folder depends on $dep_folder, which is not archived yet"
      done
    fi
    ;;
esac

# --- refuse implement before analyze has run (spec 344, table spec 356) -----
# The same field aide-archive-spec already reads for its own
# not-implemented-yet gate (checking for `implement` there instead of
# `analyze` here) — one workflow step earlier. Placed beside
# DEPENDENCY_GATED_STEPS, for the same reason: before anything touches a
# checkout, so a refusal here leaves nothing behind. Applies to `implement`
# alone; `analyze` and `archive` keep their own, unrelated gates.
#
# The one table (core/scripts/lib/transitions.json) decides now, via its
# read-only pre-check: created --implement--> refused (not-analyzed-yet),
# analyzed/implemented --implement--> legal. Same reason, same message.
if [ "$command_name" = "implement" ]; then
  status_file="$specs_root/$spec_folder/4-status.md"
  if declare -f may_apply_spec_transition >/dev/null 2>&1; then
    # A status file that does not exist yet reads as phase "created"
    # (_peek_spec_state derives an empty state), which the table refuses
    # implement from — same as the old code's default "no" for a missing
    # file.
    may_apply_spec_transition "$status_file" "implement" \
      || refuse "$transition_message" "$transition_refusal"
  fi
fi

# The main checkout is put back ON its default branch and never taken off
# it again. The switch is NOT a courtesy: a checkout left on `aide/<spec>`
# by an older run — a cancel, or any refusal after the branch block —
# would make git refuse `worktree add` for that branch (`fatal: '…' is
# already used by worktree at …`) with no self-healing path.
#
# The pull IS a courtesy, and is recorded rather than fatal. The worktree
# is cut from origin/$base, so correctness no longer depends on this
# tree's HEAD; a race lost to a concurrent run costs the dashboard a
# staler spec list and nothing else. It also has to name $base
# explicitly: `git pull --ff-only` acts on the CURRENT branch, so a
# checkout stuck on an old spec branch used to be advanced on THAT
# branch, run after run.
pull_error=""
note_pull_error() {
  [ -z "$pull_error" ] && pull_error="$1" || pull_error="$pull_error; $1"
}

for root in "${roots[@]}"; do
  base="$(default_branch "$root")"
  [ -n "$base" ] || refuse "Cannot work out the default branch in $root"
  if [ "$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null)" != "$base" ]; then
    git -C "$root" switch -q "$base" 2>/dev/null || refuse "Cannot switch to $base in $root"
  fi
  if [ "$do_pull" = "yes" ] && git -C "$root" remote get-url origin >/dev/null 2>&1; then
    if git -C "$root" fetch -q origin "$base" 2>/dev/null; then
      git -C "$root" merge -q --ff-only "origin/$base" 2>/dev/null \
        || note_pull_error "cannot fast-forward $base (aide/$spec_label in $root)"
    else
      note_pull_error "cannot fetch $base (aide/$spec_label in $root)"
    fi
  fi
done

