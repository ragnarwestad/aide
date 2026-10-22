# Resolving the conflict close was handed

## Table of contents

- [Why this routine exists](#why-this-routine-exists)
- [What you are standing in](#what-you-are-standing-in)
- [Workflow](#workflow)
  - [Step 1: See what the conflict is](#step-1-see-what-the-conflict-is)
  - [Step 2: Resolve, or decide not to](#step-2-resolve-or-decide-not-to)
  - [Step 3: Finish the merge](#step-3-finish-the-merge)
  - [Step 4: Run the tests the resolution touched](#step-4-run-the-tests-the-resolution-touched)
  - [Step 5: Carry on, or undo](#step-5-carry-on-or-undo)
- [The one thing this routine must never do](#the-one-thing-this-routine-must-never-do)

---

## Why this routine exists

Finish the specs branch's open merge before closing the spec. A successful
resolution lets the dashboard land the updated specs branch; an unsafe
resolution leaves the branch exactly as it was found and stops close.
The code branch is discarded by close, never merged by this routine.

## What you are standing in

`aide-run-spec` has already started the merge. A conflict confined to the
spec's own `4-status.md` is resolved mechanically with the default
branch's copy before this routine starts. Any remaining conflict needs
both sides' intent checked below.

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
the one failure this routine can cause that nobody sees, and close
lands the specs changes it resolves.

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

### Step 4: Run the tests the resolution touched

Run the tests covering the files the resolution changed — the ones that
conflicted, and any you edited to settle them — never the full suite.
The landing runs the full suite once, on exactly this merge, before it
pushes anything: this routine only needs the tests covering its resolution.
To find the right tests, use the project's own test command,
narrowed to those files, in single-run mode:

`AIDE_TEST_CMD`, as `aide-resolve-test-cmd --project-dir .` prints it.

Run it in the worktree you are standing in, once, in the foreground —
never in the background to poll, and never a second run while one is
going. A failing test that has nothing to do with the merge and passes
when run on its own is the machine's load, not a fault: do not run the
suite again for it; say so in the report. If the project has no test
command at all, say so plainly in the report — that is a real fact about
the resolution's confidence, not a detail to leave out.

**The landing is the gate the whole design rests on.** A machine
resolving a conflict unattended and then landing it is defensible
because the landing runs the project's full suite on the merge and a
red one does not land. This narrower run is the resolution's own first
check: never skip it, and never report a resolution as done without it.

### Step 5: Carry on, or undo

**Tests green:** the resolution is finished. Go back to
`/aide-close`'s Step 1 and run `aide-close-spec` again — now past the
conflict, it checks the closing reason and moves the spec exactly as an
ordinary run does. `aide-run-spec` commits anything still uncommitted,
pushes the BRANCH, and reports the run. There is nothing to push by
hand.

**Tests red, or you decided in Step 2 not to resolve:** put the branch
back exactly where you found it, then report why. Close stops here —
do NOT go on to stamp or move the folder.

```bash
# The merge was never committed:
git merge --abort

# The merge WAS committed and the tests then went red — go back to the
# commit the branch was on before this run touched it:
git reset --hard <the sha from `git log --oneline` before the merge commit>
```

Then say, in one paragraph a user reads on the row: which files
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
merged by the dashboard once close has reported success — never by
this routine, and never half-way.

IMPORTANT:

- Stopping is a successful outcome of this routine, not a failure of
  it — an unresolvable conflict reported plainly is worth more than a
  guess. It does mean close stops too: a spec whose branch will not
  merge is not a spec that can be closed
- Never leave `MERGE_HEAD` set: finish the merge or abort it
- Code blocks ALWAYS end with just ` ``` ` — NEVER ` ```text ` as the
  closing fence
