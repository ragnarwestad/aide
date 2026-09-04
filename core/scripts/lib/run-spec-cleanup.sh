#!/usr/bin/env bash
# run-spec-cleanup.sh — leaving the machine usable.
#
# Sourced by aide-run-spec at the point this ran when it was part of
# that file, so the order, and every variable it shares with the rest
# of the run, are exactly what they were. Split out 2026-09-04: the
# script had reached 2925 lines, five times the next largest file in
# the repo, and no reader could hold it.
# --- leaving the machine usable ----------------------------------------------
# Whatever the step managed to write is committed, with the reason in the
# message. Leaving it uncommitted is not the safe option it looks like:
# the dirty-tree refusal above would block every later run.
# WHERE it is committed depends on what the step already did (spec 146).
# A step may commit some of its own work and leave the rest — the global
# git rules let it stage new files by name but leave modified tracked
# ones to a user in an IDE, and headlessly there is none. Committing the
# leftover afresh then split one step's change across two commits, one
# of them carrying only the generic subject below. So the loop amends
# the step's own commit when HEAD has moved since the run started, and
# only opens a commit of its own when the step made none.
suffix=""
[ "$terminal_reason" != "completed" ] && suffix=" (stopped: $terminal_reason)"

# Spec 217: WHO ran the step, next to what happened to it. The tool is
# always known — it defaults to `claude` and is refused if it is neither
# of the two — so this is never empty; the model VALUE is only there
# when the caller named one, and is left out rather than guessed at.
#
# It sits BEFORE `$suffix` in every subject that carries both: the stop
# reason is read greedily to the end of the subject, so a suffix after
# it would be swallowed into the reason and every subject written before
# this change would start parsing differently.
model_value="$tool${model:+ $model}"
model_suffix=" (model: $model_value)"
# What the amend branches append on a line of their own. Both suffixes
# carry a leading space because the generated subject below is one line;
# the appended line drops the first of them.
amend_note="${model_suffix}${suffix}"

#
# The commit happens in the WORKTREE; the reported `root` is the main
# checkout. Four places consume those paths after the run is over — the
# page's per-repo label, `isMerged`, the Merge action and `branchesFor` —
# and a worktree path is deleted when the run ends, so reporting it would
# make the labels read as job ids, `isMerged` answer false forever, and
# Merge fail in a directory that no longer exists.
# An `archive` step is the only one that can be interrupted MID-MERGE:
# it is the one started with the conflict open (see update_branch_to_base
# above), and a crash, a cancellation or a budget stop between opening it
# and deciding leaves MERGE_HEAD set with the markers still in the files.
# The generic loop below would then `git add -A` those markers and commit
# them as the merge — the half-merged tree the rest of this script exists
# to never leave anywhere. Undoing it here puts the branch back exactly
# where the step found it, which is also what "leaves the branch as it
# found it" means when /aide-archive gives up on the resolution on
# purpose.
if [ "$command_name" = "archive" ]; then
  for wt in "${work_roots[@]}"; do
    git -C "$wt" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 || continue
    git -C "$wt" merge --abort >/dev/null 2>&1 || true
  done
fi

