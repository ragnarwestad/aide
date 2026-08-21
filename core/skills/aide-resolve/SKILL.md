---
name: aide-resolve
description: >-
  Resolve the merge conflict between a spec's branch and the default
  branch, run the project's tests, and leave the branch either finished
  or exactly as it was found.
  Use when: the dashboard refused to land a spec's branch for a
  conflict, a spec branch cannot be brought up to date with the default
  branch.
  Do NOT use for: implementing a spec (use aide-implement), merging a
  clean branch (that needs no step at all), resolving conflicts in a
  checkout aide-run-spec did not prepare.
argument-hint: "[<JIRA-KEY> or task number]"
effort: medium
---

Finish a merge that git could not finish on its own — or decide it
cannot be finished safely, and put everything back.

**Input:** $ARGUMENTS (a JIRA key, a task number, or a full folder ID)

## Table of contents

- [Why this step exists](#why-this-step-exists)
- [What you are standing in](#what-you-are-standing-in)
- [Workflow](#workflow)
  - [Step 1: See what the conflict is](#step-1-see-what-the-conflict-is)
  - [Step 2: Resolve, or decide not to](#step-2-resolve-or-decide-not-to)
  - [Step 3: Finish the merge](#step-3-finish-the-merge)
  - [Step 4: Run the project's tests](#step-4-run-the-projects-tests)
  - [Step 5: Stop, or undo](#step-5-stop-or-undo)
- [The one thing this step must never do](#the-one-thing-this-step-must-never-do)

---

## Why this step exists

The dashboard refuses to land a spec whose branch conflicts with the
default branch: "cannot merge … (conflict)". The by-hand routine that
followed was always the same — merge the default branch into the spec's
branch in a worktree, resolve, run the tests, push the branch. This
step IS that routine. When it reports success the dashboard lands the
resolved branch itself, as it lands every step's work (spec 149); when
it stops, the branch is left exactly as it was found and the refusal
stays on the row.

## What you are standing in

`aide-run-spec` has already done the first half. Your working directory
is a throwaway worktree of the spec's branch, and the merge is **open**:

- `MERGE_HEAD` is set — `git rev-parse -q --verify MERGE_HEAD` answers
- the conflicted files carry `<<<<<<<`/`=======`/`>>>>>>>` markers
- `ours` is the spec's branch, `theirs` is the default branch

Nothing else is prepared for you. The default branch is never touched by
this step, in this worktree or anywhere else.

## Workflow

### Step 1: See what the conflict is

1. `git status --short` — the `UU`/`AA`/`DU` entries are the conflict
2. `git log --oneline HEAD..MERGE_HEAD` — what landed on the default
   branch since the spec's branch was made
3. `git log --oneline MERGE_HEAD..HEAD` — what the spec's own work is

Read the spec's `1-description.md` and `3-solution.md` if the branch's
intent is not obvious from its commits. Both sides had a reason; you are
merging two intents, not two texts.

### Step 2: Resolve, or decide not to

Resolve each conflicted file so that **both** sides' intent survives.
Never a mechanical `--ours`/`--theirs` across the board: that discards
one side's work by policy rather than by judgement.

**Bias toward stopping.** Resolving is worth doing when the two sides
touched the same region for unrelated reasons — an import list, a table
of entries, adjacent functions, a document's sections. It is NOT worth
guessing at when the two sides changed the same logic in incompatible
ways, when either side's intent is unclear, or when a correct merge
would mean writing new code neither side wrote. In those cases go
straight to Step 5 and undo — a wrong merge that passes thin tests is
the one failure this step can cause that nobody sees.

Then remove every marker and `git add` each file you resolved.
`git diff --check` and `grep -rn '<<<<<<<'` over the resolved files
before moving on: a marker left in a file is a syntax error committed.

### Step 3: Finish the merge

```bash
git commit --no-edit
```

The merge was started with `--no-edit`, so the message git prepared is
the right one. Do not amend it and do not add a second commit for the
resolution — the merge commit IS the resolution.

### Step 4: Run the project's tests

Use the project's own test command, in single-run mode:

1. `AIDE_TEST_CMD` from `.aide/config` in the project root if it is set
2. otherwise detect it from what the project ships (the lockfile or
   build file), exactly as `/aide-implement` does

Run it in the worktree you are standing in. If the project has no test
command at all, say so plainly in the report — that is a real fact about
the resolution's confidence, not a detail to leave out.

### Step 5: Stop, or undo

**Tests green:** stop here. `aide-run-spec` commits anything still
uncommitted, pushes the BRANCH, and reports the run. There is nothing
else to do, and nothing to push by hand.

**Tests red, or you decided in Step 2 not to resolve:** put the branch
back exactly where you found it, then report why.

```bash
# The merge was never committed:
git merge --abort

# The merge WAS committed and the tests then went red — go back to the
# commit the branch was on before this run touched it:
git reset --hard <the sha from `git log --oneline` before the merge commit>
```

Then say, in one paragraph a person reads on the row: which files
conflicted, what the two sides wanted, and what stopped you — the test
that failed by name, or the judgement you would not make. Do not
recommend a next step you did not take.

`git status --porcelain` must be empty and `HEAD` must be back at the
commit the branch started on. That is what leaves the branch untouched:
`aide-run-spec` pushes a repo only when its `HEAD` moved, so a branch
put back where it was reaches origin at all.

## The one thing this step must never do

**Never push, and never touch the default branch.** No `git push`, no
`git switch main`, no merge in the other direction. `aide-run-spec`
owns the push and pushes the spec's branch only; the default branch is
merged by the dashboard once this step has reported success — never by
this step, and never half-way.

IMPORTANT:
- Stopping is a successful outcome of this step, not a failure of it —
  an unresolvable conflict reported plainly is worth more than a guess
- Never leave `MERGE_HEAD` set: finish the merge or abort it
- Code blocks ALWAYS end with just ` ``` ` — NEVER ` ```text ` as the
  closing fence
