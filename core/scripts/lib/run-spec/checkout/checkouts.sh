#!/usr/bin/env bash
# run-spec/checkout/checkouts.sh — where this run's checkouts go, what a worktree lacks, and the cleanup installed before the first one.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were.
# --- where this run's checkouts go -------------------------------------------
[ -n "$worktree_base" ] || worktree_base="$HOME/.aide/dashboard/worktrees"
case "$worktree_base" in /*) ;; *) worktree_base="$PWD/$worktree_base" ;; esac
refuse_base_inside_a_root() {
  local candidate="$1" root
  for root in "${roots[@]}"; do
    case "$candidate/" in
      "$root"/*)
        refuse "the worktree base $candidate is inside $root — a worktree there would be committed by the run"
        ;;
    esac
  done
}
# Checked BEFORE the directory is created, and again once the real path is
# known: a symlinked base could resolve into a root the literal path did
# not name.
refuse_base_inside_a_root "$worktree_base"
mkdir -p "$worktree_base" 2>/dev/null || refuse "cannot create the worktree base at $worktree_base"
worktree_base="$(cd "$worktree_base" && pwd -P)" || refuse "cannot resolve the worktree base"
refuse_base_inside_a_root "$worktree_base"
# Keyed by project AND spec: two projects can share one specs repo, and a
# path keyed by the spec alone would put both runs in the same directory.
# The dashboard keeps every project's clone at `checkouts/<project>/code`,
# so there the project is the parent directory's name, not the clone's.
worktree_project_key() {
  local root="$1" parent
  parent="$(dirname "$root")"
  if [ "$(basename "$root")" = "code" ] && [ "$(basename "$(dirname "$parent")")" = "checkouts" ]; then
    basename "$parent"
  else
    basename "$root"
  fi
}
wt_dir="$worktree_base/$(worktree_project_key "$project_root")/$spec_label"

# --- the dependencies a worktree lacks ---------------------------------------
# `git worktree add` checks out TRACKED files only, so every gitignored
# path is absent — `.venv` and `dashboard/node_modules` in this repo,
# without which pytest and bun both fail for a reason that has nothing to
# do with the change. Which paths matter cannot be derived without
# guessing, so the project states them.
#
# The COMMITTED manifest alone (spec 549): `.aide/project.yaml` travels
# with the repo, so a checkout that has never been configured on this
# machine still knows which gitignored paths its commands need.
# Which file was read is REPORTED — to stderr for whoever is
# watching the run, and in the result blob for whatever reads that.
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
      refuse "$links_key names a build output, not a dependency cache: $entry — such a directory is generated per worktree and wants no link at all"
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
# The checkout locks a cancelled step holds through its commit and the
# removal of its worktrees (on_signal): released after both, in the EXIT
# trap, so a run on the same branch waits for them.
signal_locks=()
release_signal_locks() {
  local lock
  for lock in ${signal_locks[@]+"${signal_locks[@]}"}; do rm -rf "$lock" 2>/dev/null || true; done
  signal_locks=()
}
# Waits for one checkout's lock, as acquire_worktree_lock does, but never
# refuses: a lock still held after two minutes is left, and the commit goes
# ahead without it, as it always did.
take_signal_lock() {
  local lock="$1/.git/aide-run-spec-worktree.lock" deadline owner
  [ "$lock" = "${worktree_lock:-}" ] && return 0
  deadline=$(( $(date +%s) + 120 ))
  while ! mkdir "$lock" 2>/dev/null; do
    owner="$(cat "$lock/pid" 2>/dev/null || true)"
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then rm -rf "$lock" 2>/dev/null || true; continue; fi
    [ "$(date +%s)" -ge "$deadline" ] && return 0
    sleep 0.2
  done
  echo $$ > "$lock/pid" 2>/dev/null || true
  signal_locks+=("$lock")
}
trap 'keep_stream; remove_worktrees; release_signal_locks; delete_empty_branches; release_worktree_lock; rm -rf "$work_dir"' EXIT
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
  # Cancel keeps what the step wrote: committed and pushed to its branch
  # before the EXIT trap removes the worktree with --force, so the next
  # run of the step finds it there. Once the worktrees exist, that is —
  # a run cancelled before then has written nothing. A Cancel mid-turn
  # comes before the committing code is loaded and before the names it
  # reads are set, so both are seen to here, and `set +u` keeps a name
  # this path never set from ending the handler before the commit.
  if [ -n "${work_roots[*]:-}" ]; then
    set +u
    # Under each checkout's lock, held until the worktrees are gone: a run
    # started on the same branch meanwhile — a wiki build re-queued at a
    # restart — cuts its worktree only after this commit, never during it.
    for root in ${roots[@]+"${roots[@]}"}; do take_signal_lock "$root"; done
    suffix=" (stopped: cancelled)"
    commit_label="${commit_label:-$spec_label}"
    declare -f commit_and_push_roots >/dev/null 2>&1 \
      || source "$SCRIPT_DIR/lib/run-spec/publish/publish.sh" >/dev/null 2>&1
    commit_and_push_roots >/dev/null 2>&1 || true
  fi
  aide_part_close "stopped: cancelled"
  exit 143
}
trap on_signal TERM INT
