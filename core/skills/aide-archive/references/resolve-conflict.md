# Resolving the conflict archive was handed

Finish a merge that git could not finish on its own — or decide it
cannot be finished safely, and put everything back.

This is `/aide-archive`'s first step, and only when there is a conflict
open. It was a step of its own (`/aide-resolve`) until spec 171: a merge
that fails is the merging step's problem, not a sixth phase standing
beside the five.

## Table of contents

- [Why this routine exists](#why-this-routine-exists)
- [What you are standing in](#what-you-are-standing-in)
- [Workflow](#workflow)
  - [Step 1: See what the conflict is](#step-1-see-what-the-conflict-is)
  - [Step 2: Resolve, or decide not to](#step-2-resolve-or-decide-not-to)
  - [Step 3: Finish the merge](#step-3-finish-the-merge)
  - [Step 4: Run the project's tests](#step-4-run-the-projects-tests)
  - [Step 5: Carry on, or undo](#step-5-carry-on-or-undo)
- [The one thing this routine must never do](#the-one-thing-this-routine-must-never-do)

---

## Why this routine exists

A spec's branch is brought up to date with the default branch before the
step's own work starts. Every other step treats a conflict there as a
person's problem and refuses on the spot. `archive` is the step that
LANDS the branch, so the conflict is its own to settle: the by-hand
routine that used to follow was always the same — merge the default
branch into the spec's branch in a worktree, resolve, run the tests,
push the branch — and this routine IS that routine. When archive goes on
to report success the dashboard lands the resolved branch itself, as it
lands every step's work (spec 149); when this routine stops, the branch
is left exactly as it was found, archive stops with it, and the failure
is what the row says.

## What you are standing in

`aide-run-spec` has already done the first half — including one narrow
case this routine never sees at all (spec 280): a conflict confined to
the spec's own `4-status.md`, and nothing else, resolves mechanically
before this step ever starts, taking the default branch's copy (a direct
correction, not a second intent to merge). If you are standing in a
conflict at all, it is either a genuine collision or one that mechanical
check could not resolve on its own — either way, "bias toward stopping"
below is scoped to real code/prose conflicts, which is what it was
always written for.

Your working directory is a throwaway worktree of the spec's branch, and
the merge is **open**:

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
the one failure this routine can cause that nobody sees, and archive
lands what it resolves.

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
2. otherwise `testCmd` from the committed `.aide/project.yaml` if it is set
3. otherwise detect it from what the project ships (the lockfile or
   build file), exactly as `/aide-implement` does

Run it in the worktree you are standing in. If the project has no test
command at all, say so plainly in the report — that is a real fact about
the resolution's confidence, not a detail to leave out.

If the project's manifest has a `testScopes:` list, the command is not one
command but the set the MERGE's changed files resolve to — this spec's own
diff plus whatever the default branch brought in
(`git diff --name-only ORIG_HEAD...HEAD`, and the files the resolution
touched). Sort them by the rule the tools-and-scripts skill gives and run
every scope with a file in it, plus the root command if any file matched
none. A merge reaching both halves runs both; one reaching only a scoped
subdirectory does not pay for the root command. Name the command(s) that
ran in the report, as this step already names the absence of one.

**This is the gate the whole design rests on.** A machine resolving a
conflict unattended and then landing it is defensible because a
resolution that does not pass the project's own tests does not land.
Never skip this run, and never report a resolution as done without it.

### Step 5: Carry on, or undo

**Tests green:** the resolution is finished. Go back to
`/aide-archive`'s Step 1 and run `aide-archive-spec` again — now past the
conflict, it reads the status tables and decides the rest exactly as an
ordinary run does. `aide-run-spec` commits anything still uncommitted,
pushes the BRANCH, and reports the run. There is nothing to push by
hand.

**Tests red, or you decided in Step 2 not to resolve:** put the branch
back exactly where you found it, then report why. Archive stops here —
do NOT go on to stamp or move the folder.

```bash
# The merge was never committed:
git merge --abort

# The merge WAS committed and the tests then went red — go back to the
# commit the branch was on before this run touched it:
git reset --hard <the sha from `git log --oneline` before the merge commit>
```

Then say, in one paragraph a person reads on the row: which files
conflicted, what the two sides wanted, and what stopped you — the test
that failed by name, or the judgement you would not make. Name the
branch, because a conflict that reaches a reader is one no machine could
settle and the diff is where they have to look. Do not recommend a next
step you did not take.

`git status --porcelain` must be empty and `HEAD` must be back at the
commit the branch started on. That is what leaves the branch untouched:
`aide-run-spec` pushes a repo only when its `HEAD` moved, so a branch
put back where it was never reaches origin. If this routine dies before
it decides — a crash, a cancellation, a budget stop — `aide-run-spec`
aborts the unfinished merge itself before its commit loop runs, so the
conflict markers are never committed as a resolution either way.

## The one thing this routine must never do

**Never push, and never touch the default branch.** No `git push`, no
`git switch main`, no merge in the other direction. `aide-run-spec`
owns the push and pushes the spec's branch only; the default branch is
merged by the dashboard once archive has reported success — never by
this routine, and never half-way.

IMPORTANT:

- Stopping is a successful outcome of this routine, not a failure of
  it — an unresolvable conflict reported plainly is worth more than a
  guess. It does mean archive stops too: a spec whose branch will not
  merge is not a spec that can be archived
- Never leave `MERGE_HEAD` set: finish the merge or abort it
- Code blocks ALWAYS end with just ` ``` ` — NEVER ` ```text ` as the
  closing fence
