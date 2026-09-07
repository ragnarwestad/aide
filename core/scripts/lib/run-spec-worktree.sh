#!/usr/bin/env bash
# run-spec-worktree.sh — one throwaway checkout per root, and the lock that keeps two runs out of each other's.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were.
# --- one throwaway checkout per root -----------------------------------------
# The main trees are not touched here, so two runs on the same repos
# cannot see each other's branch. Parallel indexed arrays again, not
# associative ones: macOS ships bash 3.2.
used_names=()
unique_basename() {   # sets $wt_name
  local want="$1" candidate used clash n=1
  candidate="$want"
  while :; do
    clash="no"
    for used in ${used_names[@]+"${used_names[@]}"}; do
      [ "$used" = "$candidate" ] && clash="yes"
    done
    [ "$clash" = "no" ] && break
    n=$(( n + 1 )); candidate="$want-$n"
  done
  used_names+=("$candidate")
  wt_name="$candidate"
}

# SIGKILL cannot be trapped, so a killed run leaves a checkout behind —
# and measured: after `git worktree prune`, a leftover at a DIFFERENT
# path still gives `fatal: '<branch>' is already used by worktree at …`.
# So the sweep matches by BRANCH, wherever it stands, and only then by
# path. The main worktree is never removed, whatever it holds.
sweep_worktree() {
  local root="$1" br="$2" wt="$3" cur="" line
  git -C "$root" worktree prune >/dev/null 2>&1 || true
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) cur="${line#worktree }" ;;
      "branch refs/heads/$br")
        if [ -n "$cur" ] && [ "$cur" != "$root" ]; then
          git -C "$root" worktree remove --force "$cur" >/dev/null 2>&1 || true
          case "$cur/" in "$worktree_base"/*) rm -rf "$cur" 2>/dev/null || true ;; esac
        fi
        ;;
    esac
  done <<EOF
$(git -C "$root" worktree list --porcelain 2>/dev/null)
EOF
  if [ -e "$wt" ]; then
    git -C "$root" worktree remove --force "$wt" >/dev/null 2>&1 || true
    rm -rf "$wt" 2>/dev/null || true
  fi
  git -C "$root" worktree prune >/dev/null 2>&1 || true
}

# origin/<base> when there is one: a stale main checkout must not decide
# what a reused branch is merged with.
base_ref_for() {   # sets $base_ref
  local root="$1" b="$2"
  if git -C "$root" show-ref --verify --quiet "refs/remotes/origin/$b"; then
    base_ref="origin/$b"
  else
    base_ref="$b"
  fi
}

# The branch already exists, because the previous step for this spec made
# it — and that reuse is deliberate: analyze and implement
# build on each other's work. But the default branch has moved on since,
# and a branch left over from the morning made the step read the
# morning's code. Measured 2026-08-16, while review-plan was still a
# separate step (spec 181 folded it into analyze): it reviewed a file
# whose bug had been fixed hours earlier.
#
# One step is the exception, and it is the exception on purpose: an
# `archive` run is the step that LANDS the branch, so a conflict with the
# default branch is its own problem to solve and not a phase of its own
# (spec 171 folded the standalone `resolve` step into it). It is handed
# the worktree exactly as git left it — MERGE_HEAD set, the markers in
# the files — and /aide-archive decides, resolving and running the
# project's tests before it does anything else. The condition is the
# literal string `archive` and nothing else, never a denylist: a step
# this got backwards would carry conflict markers into a commit, which is
# worse than the refusal it replaced.
# The branch is a shared thing, and this checkout holds one copy of it.
# A resolve done anywhere else — another machine, or by hand and pushed
# — leaves this ref at the old tip, and the reuse above then runs the
# step against the code the conflict was already resolved away from.
# Measured on spec 150 (2026-08-21): two Runs refused for a conflict
# that had been fixed and pushed an hour earlier, because the serving
# host's own ref had never moved. The refusal even recommended the thing
# that produces this ("merge it by hand").
#
# Fast-forward only, and by name when it cannot: a local ref carrying
# commits origin has not got is work this machine has not pushed, and
# overwriting it would throw that away. A repo with no origin, or an
# origin that cannot be reached, changes nothing — the local ref is then
# the only copy there is.
#
# Safe to move the ref here because sweep_worktree has already removed
# any worktree holding the branch, and the main checkout is on its
# default branch by this point.
sync_branch_with_origin() {
  local root="$1" br="$2" tip="" here=""
  git -C "$root" remote get-url origin >/dev/null 2>&1 || return 0
  # A local branch origin no longer has is a leftover of a run whose
  # branch landed and was deleted (or never pushed): cut this run from
  # the base instead of from that stale copy. Its status file said
  # "create, analyze" about specs whose implement had long landed
  # (351, 356 on 2026-09-03), and every archive was refused on it.
  # Only a branch that once tracked origin: a branch nobody ever pushed
  # is simply local work, and stays.
  if [ -n "$(git -C "$root" config --get "branch.$br.remote" 2>/dev/null)" ] \
     && ! git -C "$root" ls-remote --exit-code --heads origin "$br" >/dev/null 2>&1; then
    git -C "$root" branch -D "$br" >/dev/null 2>&1 || true
    return 0
  fi
  git -C "$root" fetch -q --force origin "refs/heads/$br:refs/aide-branch/tip" >/dev/null 2>&1 || return 0
  tip="$(git -C "$root" rev-parse --verify -q refs/aide-branch/tip 2>/dev/null || true)"
  here="$(git -C "$root" rev-parse --verify -q "refs/heads/$br" 2>/dev/null || true)"
  git -C "$root" update-ref -d refs/aide-branch/tip >/dev/null 2>&1 || true
  { [ -n "$tip" ] && [ -n "$here" ]; } || return 0
  [ "$tip" = "$here" ] && return 0
  # Origin is behind: this machine has commits it has not pushed yet,
  # which the push step at the end of the run is what deals with.
  git -C "$root" merge-base --is-ancestor "$tip" "$here" >/dev/null 2>&1 && return 0
  if git -C "$root" merge-base --is-ancestor "$here" "$tip" >/dev/null 2>&1; then
    git -C "$root" branch -f "$br" "$tip" >/dev/null 2>&1 \
      || refuse "cannot fast-forward $br to origin's copy in $root — merge it by hand, in the checkout on the serving host"
    return 0
  fi
  refuse "$br has diverged from origin's copy in $root (each has commits the other has not) — reconcile them by hand, in the checkout on the serving host"
}

# True when $sha is already what origin's $branch points at — the only
# case amending it would rewrite public history (REQ-1, spec 328).
# Best-effort, like sync_branch_with_origin: an origin nobody can reach
# answers "no", which sends this root down the existing plain-commit
# path rather than blocking the run on a network call. A plain
# sha-equality check against origin's tip, not sync_branch_with_origin's
# ancestry walk — the question here is narrower ("is this one commit
# already public"), not "has the branch diverged", so it does not need
# merge-base at all.
#
# The PUSH url, explicitly — never the bare "origin" name. `ls-remote
# origin` always reads the FETCH url, and a repo may keep that pointed at
# a real address (so the compare link can be derived from it, below)
# while a separately configured push url is where a push actually lands.
# The two coincide for every real project this script runs against — a
# push url is only ever set apart from the fetch url in this suite's own
# fixtures — so this is never a behavior change outside tests, only a
# correctness fix for what "already on origin" asks.
commit_already_on_origin() {
  local root="$1" sha="$2" remote_sha="" push_url=""
  push_url="$(git -C "$root" remote get-url --push origin 2>/dev/null)" || return 1
  [ -n "$push_url" ] || return 1
  remote_sha="$(git -C "$root" ls-remote --heads "$push_url" "$branch" 2>/dev/null | cut -f1)"
  [ -n "$remote_sha" ] && [ "$remote_sha" = "$sha" ]
}

# True when every root the step actually put content on has a LOCAL tip
# that is exactly what origin's copy of $branch points at right now —
# REQ-1/REQ-2 (spec 343), checked as the LAST git operation against each
# root before the run's outcome is decided, so nothing after it can amend
# the picture it read. Sets $unpushed_roots (comma-separated) for the
# caller to name in the failure it reports (REQ-3). push_mode "none"
# never intends to publish anything, so it is not asked this question at
# all — a local/manual run is unaffected, same as every other best-effort
# check in this script leaves an unreachable origin exactly as found.
#
# A root whose branch has nothing beyond its own default branch is
# skipped, the same way commit_and_push_roots's own push loop already
# skips pushing it: an `analyze` step never touches the project root, and
# without this exemption THAT root would fail confirmation on every
# single run (origin never has a ref by this spec's branch name there at
# all) even though nothing was ever meant to reach it.
roots_confirmed_on_origin() {
  unpushed_roots=""
  [ "$push_mode" = "none" ] && return 0
  local i=0 root default_tip
  for root in "${roots[@]}"; do
    default_tip="$(git -C "$root" rev-parse HEAD 2>/dev/null || echo "")"
    if [ "${head_after_per_root[$i]}" != "$default_tip" ] \
       && ! commit_already_on_origin "$root" "${head_after_per_root[$i]}"; then
      unpushed_roots="$unpushed_roots${unpushed_roots:+, }$root"
    fi
    i=$(( i + 1 ))
  done
  [ -z "$unpushed_roots" ]
}

# True when $br's local tip is already contained in origin's $base — the
# mark of work that landed and was never cleaned up in this checkout
# (spec 197). The landing deletes the branch on origin; this copy was
# left behind, and the reuse block below picks a branch up by name alone.
# Spec 181 was reopened onto exactly such a leftover and refused to
# start, carrying a conflict with a main that had moved on.
#
# The question is "is the work in origin's default branch", never "is the
# branch still on origin": a push that never arrived leaves a branch
# missing from origin too, and that one holds the only copy of real work.
#
# Its own fetch, and a forced one: --pull is off by default, so nothing
# guarantees this checkout's refs/remotes/origin/<base> has ever been
# refreshed — and a landing that happened on another machine is invisible
# in a ref this checkout never fetched. Best effort like every other
# network call here: an origin nobody can reach leaves the branch exactly
# as found, never treated as landed on the strength of a failed call.
branch_already_landed() {
  local root="$1" br="$2" base="$3" tip="" landed=1
  # --refmap=, or this question answers a different one. A fetch with
  # an explicit refspec ALSO updates the remote-tracking refs
  # its configured refspec covers, so asking about origin's base quietly
  # moved this checkout's refs/remotes/origin/<base> — the very ref
  # base_ref_for picked a moment earlier — and the branch was then
  # merged with a base nobody chose.
  git -C "$root" fetch -q --refmap= --force origin "refs/heads/$base:refs/aide-branch/landed-base" >/dev/null 2>&1 \
    || return 1
  tip="$(git -C "$root" rev-parse --verify -q "refs/heads/$br" 2>/dev/null || true)"
  if [ -n "$tip" ] \
     && git -C "$root" merge-base --is-ancestor "$tip" refs/aide-branch/landed-base >/dev/null 2>&1; then
    landed=0
  fi
  # The verdict is captured above and returned below: the cleanup runs in
  # between, and $? belongs to whatever ran last.
  git -C "$root" update-ref -d refs/aide-branch/landed-base >/dev/null 2>&1 || true
  return "$landed"
}

update_branch_to_base() {
  local wt="$1" ref="$2" root="$3" conflicted="" rel="" expected1="" expected2=""
  git -C "$wt" merge -q --ff-only "$ref" 2>/dev/null && return 0
  if ! git -C "$wt" merge -q --no-edit "$ref" >/dev/null 2>&1; then
    if [ "$command_name" = "archive" ]; then
      # spec 280: a conflict confined to THIS spec's own 4-status.md is
      # not two intents to merge — main's copy is a direct correction
      # (the dashboard's tick-to-fix, or a person editing the file by
      # hand) and the branch's copy is simply stale. Main always wins.
      # Any OTHER conflicted file, still or instead, falls through
      # unchanged, open for the skill's own judgment. Only checked in
      # the specs repo itself — $specs_root/$specs_repo (:299-301,:309)
      # are already resolved globals by this point in the script.
      if [ "$root" = "$specs_repo" ]; then
        rel="${specs_root#"$specs_repo"}"; rel="${rel#/}"
        expected1="${rel:+$rel/}$spec_label/4-status.md"
        expected2="${rel:+$rel/}archive/$spec_label/4-status.md"
        conflicted="$(git -C "$wt" diff --name-only --diff-filter=U 2>/dev/null)"
        if [ "$conflicted" = "$expected1" ] || [ "$conflicted" = "$expected2" ]; then
          if git -C "$wt" checkout --theirs -- "$conflicted" 2>/dev/null \
             && git -C "$wt" add -- "$conflicted" 2>/dev/null \
             && git -C "$wt" commit -q --no-edit >/dev/null 2>&1; then
            return 0
          fi
          git -C "$wt" merge --abort >/dev/null 2>&1 || true
        fi
      fi
      return 0
    fi
    git -C "$wt" merge --abort >/dev/null 2>&1 || true
    refuse "cannot bring $branch up to date with $ref in $root — conflict, merge it by hand, in the checkout on the serving host" "conflict"
  fi
  return 0
}

link_worktree_deps() {
  local root="$1" wt="$2" entry
  for entry in ${link_paths[@]+"${link_paths[@]}"}; do
    [ -e "$root/$entry" ] || continue
    [ -e "$wt/$entry" ] && continue
    mkdir -p "$(dirname "$wt/$entry")" 2>/dev/null || continue
    ln -s "$root/$entry" "$wt/$entry" 2>/dev/null || true
  done
  return 0
}

# --- per-root worktree lock --------------------------------------------
# `git worktree add -b` is not one atomic step: it writes the branch ref,
# then registers a new entry under the root's $GIT_DIR/worktrees/, named
# from the checkout path's basename — and two specs against the same
# project share that basename (`wt_dir` differs only in the spec folder).
# Two runs racing that registration is what produced "cannot create
# $branch in a worktree of $root" for one run while another ran
# concurrently against the same checkout (spec 256).
# `sync_branch_with_origin` and `branch_already_landed` share the same
# exposure through a second, independent race: both fetch into a FIXED
# ref name un-parameterized by branch (refs/aide-branch/tip,
# refs/aide-branch/landed-base), so this lock covers them too, not only
# the worktree add — it wraps the whole per-root loop body below.
#
# mkdir is the primitive because this script has nowhere it can assume
# flock(1) exists — it is not installed on this machine or the serving
# host. Lives inside the root's own .git/ so it needs no hashing scheme
# to stay unique per root, matching mergeLock's "one repo, one merge at a
# time" scope (dashboard/src/serve.ts) reimplemented for a cross-process
# caller mergeLock's in-memory Map cannot reach.
#
# A run SIGKILLed mid-section cannot release this the way remove_worktrees
# etc. cannot run either — so a waiter checks the recorded owner's pid and
# steals the lock the moment that pid is gone, the same next-run-cleans-up
# shape sweep_worktree already uses for a killed run's leftover worktree.
#
# $worktree_lock is set ONLY once this process has actually created the
# lock dir (the line right after mkdir succeeds, never before it): a
# losing waiter that times out calls refuse (which exits 2, firing the
# EXIT trap below) and must not delete the WINNER's still-live lock,
# which is exactly what setting this variable early would do.
worktree_lock=""
acquire_worktree_lock() {
  local root="$1" lock deadline owner_pid
  lock="$root/.git/aide-run-spec-worktree.lock"
  deadline=$(( $(date +%s) + 120 ))
  while ! mkdir "$lock" 2>/dev/null; do
    owner_pid="$(cat "$lock/pid" 2>/dev/null || true)"
    if [ -n "$owner_pid" ] && ! kill -0 "$owner_pid" 2>/dev/null; then
      rm -rf "$lock" 2>/dev/null || true
      continue
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      worktree_lock=""
      refuse "timed out waiting for the worktree lock on $root (pid ${owner_pid:-unknown} may be stuck)"
    fi
    sleep 0.2
  done
  echo $$ > "$lock/pid" 2>/dev/null || true
  worktree_lock="$lock"
}
release_worktree_lock() {
  [ -n "$worktree_lock" ] && rm -rf "$worktree_lock" 2>/dev/null
  worktree_lock=""
  return 0
}
