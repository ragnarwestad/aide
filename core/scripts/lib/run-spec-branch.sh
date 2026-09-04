#!/usr/bin/env bash
# run-spec-branch.sh — a new work round: the branch goes first.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were.
# --- new work round: the branch goes first -----------------------------------
#
# An archived spec whose work has to be done again leaves its branch
# behind in four places — project-local, project-origin, specs-local,
# specs-origin — and the one that was missed is the one the next run
# refuses on, with a conflict nobody can see (measured twice, 2026-08-22
# and 2026-08-23). So `reopen` starts by removing all four.
#
# HERE, and not in the skill, for a structural reason rather than a
# stylistic one: the loop below checks `aide/<folder>` out in a worktree
# of its own, and git refuses to delete a branch that is checked out. A
# skill running inside the step could not do it if it tried. The skill
# still carries the same deletion for the OTHER surface — `/aide-reopen`
# at a keyboard, where no worktree exists — which is the same shape as
# `archive`'s merge: the script's own guard is what makes the promise
# hold whatever the model does.
#
# Every deletion tolerates "already gone": a spec whose branch was
# cleaned up by the landing that archived it is the normal case, and a
# reopen that failed on it would refuse the majority of specs. An origin
# that cannot be reached is not a reason to refuse either — the same
# best-effort rule every other network call in this script keeps.
#
# The name is not what has to disappear: the loop below cuts a fresh
# `aide/<folder>` from the default branch for this very run, and the
# reopen's own commit lives on it. What has to disappear is the earlier
# round's TIP, so that nothing is merged forward out of it.
if [ "$command_name" = "reopen" ] || [ "$command_name" = "reset" ]; then
  for root in "${roots[@]}"; do
    sweep_worktree "$root" "$branch" ""
    git -C "$root" branch -D "$branch" >/dev/null 2>&1 || true
    if git -C "$root" remote get-url origin >/dev/null 2>&1; then
      git -C "$root" push -q origin --delete "$branch" >/dev/null 2>&1 || true
      git -C "$root" update-ref -d "refs/remotes/origin/$branch" >/dev/null 2>&1 || true
      if [ "$command_name" = "reset" ]; then
        remote_ref="$(git -C "$root" ls-remote --heads origin "refs/heads/$branch" 2>/dev/null)" \
          || refuse "cannot verify that origin/$branch was removed from $root"
        [ -z "$remote_ref" ] || refuse "cannot remove origin/$branch from $root"
      fi
    fi
  done
fi

mkdir -p "$wt_dir" 2>/dev/null || refuse "cannot create the worktree directory at $wt_dir"
work_roots=()
reopen_boundary_sha=""
for root in "${roots[@]}"; do
  acquire_worktree_lock "$root"
  base="$(default_branch "$root")"
  unique_basename "$(basename "$root")"
  wt="$wt_dir/$wt_name"
  sweep_worktree "$root" "$branch" "$wt"
  base_ref_for "$root" "$base"
  # spec 356 (REQ-5): the specs repository's own default-branch tip, at
  # the moment of reopening/resetting — the boundary
  # completed_steps_for's own `--not <sha>` counts from (spec 198).
  # Captured HERE, before this run's own commits exist on top of it,
  # rather than re-read later when the stamp is written.
  if [ "$root" = "$specs_repo" ] && \
     { [ "$command_name" = "reopen" ] || [ "$command_name" = "reset" ]; }; then
    reopen_boundary_sha="$(git -C "$root" rev-parse --short "$base_ref" 2>/dev/null)"
  fi
  # A leftover from a landing is not a branch to build on: throw it away
  # and let the block below make a fresh one, exactly as if this checkout
  # had never had it (spec 197). `-D`, because the ancestry check has
  # already established the work is in origin's base, while `-d` asks a
  # question about THIS checkout's possibly-stale HEAD instead.
  if git -C "$root" show-ref --verify --quiet "refs/heads/$branch" \
     && branch_already_landed "$root" "$branch" "$base"; then
    git -C "$root" branch -D "$branch" >/dev/null 2>&1 || true
  fi
  # Sync first: a local branch origin no longer has is deleted here, and
  # the run is then cut from the base below like any first run.
  if git -C "$root" show-ref --verify --quiet "refs/heads/$branch"; then
    sync_branch_with_origin "$root" "$branch"
  fi
  if git -C "$root" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$root" worktree add -q "$wt" "$branch" 2>/dev/null \
      || refuse "cannot check out $branch in a worktree of $root"
    created_wt+=("$wt"); created_wt_root+=("$root")
    update_branch_to_base "$wt" "$base_ref" "$root"
  else
    if [ "$do_pull" = "yes" ] && git -C "$root" remote get-url origin >/dev/null 2>&1; then
      git -C "$root" fetch -q origin "$base" 2>/dev/null \
        || refuse "cannot fetch $base from origin in $root — refusing rather than cutting $branch from this checkout's own tip"
      base_ref_for "$root" "$base"
    fi
    git -C "$root" worktree add -q -b "$branch" "$wt" "$base_ref" 2>/dev/null \
      || refuse "cannot create $branch in a worktree of $root"
    created_wt+=("$wt"); created_wt_root+=("$root")
  fi
  link_worktree_deps "$root" "$wt"
  work_roots+=("$wt")
  release_worktree_lock
done

project_wt="${work_roots[0]}"
specs_wt=""
[ -n "$specs_repo" ] && [ "$specs_repo" != "$project_root" ] && specs_wt="${work_roots[1]}"

# claude's session is confined to its cwd — the project worktree — and
# every other worktree is a SIBLING of it, not a child. A step that has
# to write outside the project (archive moves the spec's folder in the
# specs repo; a passenger is edited in its own checkout) is otherwise
# told "the sandbox only allows the project" and does nothing, while the
# run reports success. Seen four times on 2026-08-18. So every root the
# step may write in is handed over explicitly.
for wt in "${work_roots[@]}"; do
  [ "$wt" != "$project_wt" ] && argv+=(--add-dir "$wt")
done
