#!/usr/bin/env bash
# run-spec-checkouts.sh — where this run's checkouts go, what a worktree lacks, and the cleanup installed before the first one.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were.
# --- where this run's checkouts go -------------------------------------------
[ -n "$worktree_base" ] || worktree_base="$HOME/aide-dashboard/worktrees"
case "$worktree_base" in /*) ;; *) worktree_base="$PWD/$worktree_base" ;; esac
refuse_base_inside_a_root() {
  local candidate="$1" root
  for root in "${roots[@]}"; do
    case "$candidate/" in
      "$root"/*)
        refuse "The worktree base $candidate is inside $root — a worktree there would be committed by the run"
        ;;
    esac
  done
}
# Checked BEFORE the directory is created, and again once the real path is
# known: a symlinked base could resolve into a root the literal path did
# not name.
refuse_base_inside_a_root "$worktree_base"
mkdir -p "$worktree_base" 2>/dev/null || refuse "Cannot create the worktree base at $worktree_base"
worktree_base="$(cd "$worktree_base" && pwd -P)" || refuse "Cannot resolve the worktree base"
refuse_base_inside_a_root "$worktree_base"
# Keyed by project AND spec: two projects can share one specs repo, and a
# path keyed by the spec alone would put both runs in the same directory.
wt_dir="$worktree_base/$(basename "$project_root")/$spec_label"

# --- the dependencies a worktree lacks ---------------------------------------
# `git worktree add` checks out TRACKED files only, so every gitignored
# path is absent — `.venv` and `dashboard/node_modules` in this repo,
# without which pytest and bun both fail for a reason that has nothing to
# do with the change. Which paths matter cannot be derived without
# guessing, so the project states them.
#
# Two files can say, and the COMMITTED one wins (spec 184).
# `.aide/project.yaml` travels with the repo, so a checkout that has
# never been configured on this machine still knows which gitignored
# paths its commands need; `.aide/config`'s older `AIDE_WORKTREE_LINKS`
# is read when the manifest names none, so a project migrated on one
# machine keeps running on the others. Which file was read is REPORTED —
# to stderr for whoever is watching the run, and in the result blob for
# whatever reads that — because a value shadowed in the other file is
# otherwise ignored in silence. The refusals below name the source they
# actually came from, which is the file to go and edit.
link_paths=()
links_raw=""
links_source=""
links_key=""
if declare -f aide_manifest_get >/dev/null 2>&1; then
  links_raw="$(aide_manifest_get worktreeLinks "$project_root")"
  if [ -n "$links_raw" ]; then
    links_source="project.yaml"
    links_key="worktreeLinks"
  fi
fi
if [ -z "$links_raw" ] && declare -f aide_config_get >/dev/null 2>&1; then
  links_raw="$(aide_config_get AIDE_WORKTREE_LINKS "$project_root")"
  if [ -n "$links_raw" ]; then
    links_source=".aide/config"
    links_key="AIDE_WORKTREE_LINKS"
  fi
fi
[ -n "$links_source" ] && echo "Worktree links: read from $links_source" >&2
for entry in $links_raw; do
  case "$entry" in
    /*) refuse "$links_key must name repo-relative paths: $entry" ;;
    *..*) refuse "$links_key must not escape the root: $entry" ;;
  esac
  # The BASENAME, so a nested module's output (`backend/build`) is the
  # same answer as a top-level one — and asked BEFORE the existence
  # check below, since a denied directory usually does exist: anyone who
  # has run the build locally has one.
  link_base="${entry##*/}"
  for denied in $WORKTREE_LINK_DENYLIST; do
    if [ "$link_base" = "$denied" ]; then
      refuse "AIDE_WORKTREE_LINKS names a build output, not a dependency cache: $entry — such a directory is generated per worktree and wants no link at all"
    fi
  done
  # A named path with nothing to link is refused rather than skipped
  # (spec 138). Skipping it is how the step got blamed for the failure:
  # the worktree came up without the `node_modules` the project SAID its
  # commands need, the test command failed, and nothing in the result
  # pointed at the missing directory. The dashboard's Add reports the
  # same entry as a reason the project cannot run — one rule, in two
  # places that have to agree about it.
  [ -e "$project_root/$entry" ] \
    || refuse "$links_key names a path that is not in $project_root: $entry"
  link_paths+=("$entry")
done
# A `dir/` gitignore rule matches directories only, and a symlink is a
# file to git — so every linked path reads as untracked and `git add -A`
# would commit it. A per-worktree info/exclude does NOT work (measured:
# `rev-parse --git-path info/exclude` inside a worktree resolves to the
# COMMON .git/info/exclude), so the exclusion has to happen where the
# staging happens: a pathspec on the add, and on the change check that
# decides whether a repo is worth branching at all.
git_add_excludes=()
for entry in ${link_paths[@]+"${link_paths[@]}"}; do
  git_add_excludes+=(":(exclude,top)$entry")
done

# --- cleanup, installed BEFORE the first worktree add ------------------------
# `refuse()` exits 2, and there are refusals inside the loop below. A
# worktree orphaned by one of them locks its branch out of every later
# run, so the trap has to be standing before the first one is created.
work_dir="$(mktemp -d)"
transcript=""
created_wt=()
created_wt_root=()
child=""

kill_group() {
  kill "-$1" "-$child" 2>/dev/null || kill "-$1" "$child" 2>/dev/null || true
}

remove_worktrees() {
  local i=0 wt
  for wt in ${created_wt[@]+"${created_wt[@]}"}; do
    git -C "${created_wt_root[$i]}" worktree remove --force "$wt" >/dev/null 2>&1 || true
    rm -rf "$wt" 2>/dev/null || true
    git -C "${created_wt_root[$i]}" worktree prune >/dev/null 2>&1 || true
    i=$(( i + 1 ))
  done
  rmdir "$wt_dir" 2>/dev/null && rmdir "$(dirname "$wt_dir")" 2>/dev/null
  return 0
}

# A branch this run cut or reused and never advanced past its base
# carries nothing a later run could lose, so it goes here rather than
# waiting for branch_already_landed's check at the START of some future
# run to find it — a check that needs origin reachable at that exact
# moment, and that only ever runs if a later run for the same spec
# happens to come along at all. Three runs were refused on 2026-08-23
# over leftovers of their own making, in two repositories each (spec
# 215). An `analyze` step commits nothing in the project, so the branch
# it cuts there is empty by design and left behind on every single run.
#
# The comparison is against base_ref_for's value, never the raw local
# default_branch: a checkout whose main lags behind origin/main would
# read a genuinely empty branch as "ahead" and skip it. Nothing here
# needs origin to be REACHABLE — only whatever refs/remotes/origin/<base>
# this checkout already has.
#
# Any commit at all — this run's or an earlier step's — leaves the branch
# alone. That is a stricter test than branch_already_landed's, which
# does delete branches carrying work once origin's base contains it.
# "HEAD moved during this run" would be the wrong question: a reused
# branch carrying an earlier step's work, that this run added nothing
# to, must survive.
#
# Strictly after remove_worktrees in the same trap: `git branch -D`
# refuses a branch still checked out somewhere. base_ref_for is defined
# further down the script than this, and that is safe — the first entry
# in created_wt_root is appended after base_ref_for's own definition has
# run, so an exit before then finds nothing to iterate.
delete_empty_branches() {
  local root base
  for root in ${created_wt_root[@]+"${created_wt_root[@]}"}; do
    base="$(default_branch "$root")"
    [ -n "$base" ] || continue
    base_ref_for "$root" "$base"
    [ "$(git -C "$root" rev-list --count "$base_ref".."$branch" 2>/dev/null)" = "0" ] || continue
    git -C "$root" branch -D "$branch" >/dev/null 2>&1 || true
  done
  return 0
}

# The transcript is copied out of $work_dir before the directory goes,
# and from the TRAP rather than from the happy path: a run that is
# killed outright still leaves its transcript behind, and those are
# the longest runs, the ones worth reading. Best effort throughout —
# a transcript that could not be copied must never turn a finished run
# into a failed one.
#
# When a --stream-file is asked for, claude writes STRAIGHT to it
# instead: the whole point of the file is to be read while the run is
# going, and copying it out at exit filled the reader's panel the
# instant the job stopped needing it. Writing there directly keeps the
# killed-run property too — the file is already on disk, so there is
# nothing left to rescue. keep_stream then only has work to do for the
# case it was written for: no --stream-file, nothing to keep.
keep_stream() {
  [ -n "$stream_file" ] || return 0
  [ -n "$transcript" ] || return 0
  [ "$transcript" != "$stream_file" ] || return 0
  [ -f "$transcript" ] || return 0
  if cp "$transcript" "$stream_file.tmp" 2>/dev/null; then
    mv "$stream_file.tmp" "$stream_file" 2>/dev/null || rm -f "$stream_file.tmp" 2>/dev/null
  fi
  return 0
}
trap 'keep_stream; remove_worktrees; delete_empty_branches; release_worktree_lock; rm -rf "$work_dir"' EXIT
# TERM and INT get a handler of their own, and NOT because the EXIT trap
# is skipped without one — measured, bash 3.2.57 runs the EXIT trap on an
# untrapped SIGTERM. The reason is the opposite: with an explicit handler
# bash no longer dies of the signal, so this one has to kill the child's
# process group, wait for it, and exit. Cancel SIGTERMs the whole group
# and `claude` is still alive when the trap fires; without the wait, a
# worktree would be removed from under a running step, and without the
# exit the deadline loop below would simply resume.
on_signal() {
  trap '' TERM INT
  local grace_end
  if [ -n "$child" ]; then
    kill_group TERM
    grace_end=$(( $(date +%s) + ${kill_grace_sec%.*} ))
    while kill -0 "$child" 2>/dev/null && [ "$(date +%s)" -lt "$grace_end" ]; do sleep 0.2; done
    kill -0 "$child" 2>/dev/null && kill_group KILL
  fi
  exit 143
}
trap on_signal TERM INT
