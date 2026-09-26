# Branches and landing

How each step's branch is merged into the default branch, what `archive` does when that merge conflicts, how origin
decides whether a landing finished, and how a project keeps its code branch open for review. The queue that makes the branches is on [Running specs](running-specs.md). What a landing refusal has to say is the one rule on
[Error sentences](error-sentences.md).

## Table of contents

- [Branches, and merging them](#branches-and-merging-them)
- [Archive resolves the conflict itself](#archive-resolves-the-conflict-itself)
- [Origin decides whether a landing finished](#origin-decides-whether-a-landing-finished)
- [The tests run on the landing, once](#the-tests-run-on-the-landing-once)
- [A root that is no longer on disk](#a-root-that-is-no-longer-on-disk)
- [A project can ask for its code branch to stay open](#a-project-can-ask-for-its-code-branch-to-stay-open)

---

## Branches, and merging them

### One branch per repository

A job that touches two repositories makes a branch of the same name in both — `aide/89-merge-from-the-dashboard`
exists in the project and in the specs repo, with different contents and two separate compare pages. Merging one
does nothing for the other: each repo's branch is landed on its own, asked of that repo's own checkout.

A project whose specs live inside it has one repo and one branch for both. There, a step that lands no code —
`analyze`, `reopen`, `close` — copies the spec's own folder, and its `archive/` twin, from the branch onto the
default branch as one commit, and leaves every other path as it was. The branch stays open for the next step,
whose run merges the default branch in before it starts; a `close` deletes it afterwards. A `wiki` step copies
`wiki/` alone and deletes its branch, since nothing follows it.

### What each step lands

Nothing here is merged by hand. Every step lands its own work as it finishes, and there is no Merge button and no
Approve button: the step that made the work is what knows it is done. Leaving `archive` unticked is the inspection
point.

- `create`, `analyze` and `wiki` merge the branch they pushed into that repo's default branch. A `wiki` step leaves the
  project's code root out.
- `implement` lands nothing. The code stays on the branch for anyone who wants to read or test it first.
- `archive` merges every repo it was told about: the roots its own run reported, plus the ones the queue's own
  history recorded for the spec. **The code root goes first and the specs root last.** The specs root carries the
  `Result: completed` stamp, and that stamp must not reach the default branch before the code landing is
  confirmed — so a failed code merge stops the loop before the specs root is attempted. After a code root merges,
  `AIDE_INSTALL_CMD` runs. Then the spec is archived.
- A step that was stopped by its own time limit, or by a provider limit, still lands what it pushed outside the
  code root.

Code reaches the default branch through `archive` alone. The loop can only merge what it knows about, which is why
it asks origin afterwards — see
[Origin decides whether a landing finished](#origin-decides-whether-a-landing-finished).

### A merged branch is deleted

Once the merge is on origin, the landing deletes the branch: first on origin, then locally. It happens after the
push and never before, since the base has to be on origin before the only other copy of those commits is removed.
A delete that fails is never fatal — the merge already happened — and is reported beside the merge, the way an
install error is.

### What is refused, and what is tried again

A landing merges the spec branch into each repo's default branch and pushes, one repo at a time:

- **A conflict refuses and names the repo.** The failed merge is aborted, so no half-merged tree is left behind —
  the same shape `aide-run-spec` already uses when it brings a reused branch up to date.
- **A dirty tree decides nothing.** A run does not dirty the main tree: it works in a worktree of its own and only
  ever fast-forwards this one. A refusal over a dirty tree could only stop a merge over somebody's unrelated
  uncommitted file. A file that genuinely collides raises git's own error instead of a guess made in advance.
- **A lost lock is not a conflict.** A run's own `aide-run-spec` writes refs in this same checkout at its start and
  its end, so a landing in the same second can lose a race for `index.lock`, `packed-refs.lock` or a ref lock. That
  is not a diverged base and must not be refused with the same sentence: the pull and the merge are retried up to
  five times, 400 ms apart, whenever git's own stderr names a lock.
- **A failed merge is tried again twice.** Beyond the lock retry, the whole per-repo merge is repeated up to three
  times, 700 ms and then 1400 ms after the first. A red test gate is the one failure that is not retried this way.
  Git's own words are kept as the row's detail.
- **Main moving under a landing is not a refusal.** A push that origin answers and still rejects means the default
  branch got commits while the tests ran. The local merge is dropped, the branch is merged again onto the base that
  moved, the tests run again on that result, and the push is made once more — once. A second rejection refuses,
  with the checkout left level with origin and never ahead of it.
- **A base ahead of origin is refused only when the commits are its own.** What an interrupted landing leaves —
  merge commits, and commits origin already holds — is not refused; the landing goes on. Unpushed work of
  somebody's own on that branch is refused, loudly, by name.
- **A code merge can install.** Merged is not deployed: for a project that installs itself somewhere, the default
  branch moving changes nothing on this machine. The command comes from `AIDE_INSTALL_CMD` in the project's
  `.aide/config`, or from `installCmd:` in its manifest, and is run in that checkout after its code merges — argv,
  no shell, bounded by a timeout, and reported beside the merge rather than turning a completed merge into a failed
  one. With neither set, nothing runs and the result says plainly that deploying is still a hand step.
- **Conflicts are expected.** Two branches touching the same file conflict at merge time, and running several specs
  side by side makes it happen more often. Both sides refuse and name the repo rather than corrupting anything, and
  `archive` settles most of them itself (below).
- **The report is per repo, never one collective "ok".** Several repos cannot be merged atomically, and one
  succeeding while another fails is exactly what has to be readable.

### The page is settled before it can see the result

The shared checkout's fast-forward is what makes a landed folder visible — the watcher rescans on it — so the merge
calls back just before it. A create job takes its assigned folder as its key, and the cached open-branch set drops
the branch; a delete that then fails puts it back. When the landing is over, the spec's cached git answers — its
workflow history, the file steps on its branch — are marked due for a fresh read, as they are the moment any of its
steps ends, so no row is drawn from what was true before.

## Archive resolves the conflict itself

A spec's branch is brought up to date with the default branch before a step's own work starts, and every step but one
treats a conflict there as a user's problem: the merge is aborted and the run refuses on the spot with
`errorReason: "conflict"`. `archive` is the exception, because
`archive` is the step that LANDS the branch — a merge that fails is the merging step's problem, not a phase of its own.

So `core/scripts/aide-run-spec` hands `archive`, and only `archive`, the worktree with the merge still open:
`MERGE_HEAD` set, the markers in the files. One conflict it settles itself first — a conflict confined to this
spec's own `4-status.md`, where the default branch's copy wins — and only what is left over reaches the skill. `/aide-archive`'s Step 1 checks for that and, when it finds it, follows
`core/skills/aide-archive/references/resolve-conflict.md` before anything else — read the conflict, resolve it or decide
not to, finish the merge with `git commit --no-edit`, run the project's own test command — and only then goes on to
archive the spec. The default branch is never touched by the step itself; the dashboard lands the resolved branch
afterwards, the way it lands any other step's work.

There is no `resolve` step and no Resolve button: a post naming `resolve` is refused as an invalid entry in `steps`,
and no control on the page draws off `errorReason`.

- **The condition is the literal string `archive`, never a denylist.**
  A step this got backwards would carry conflict markers into a commit, which is worse than a refusal.
- **It either finishes or puts the branch back.** Tests red, or a conflict the skill will not decide, and the merge is
  undone to the commit the branch started on. A branch put back never reaches origin, because a root whose
  HEAD did not move is pushed only when the run ended `completed`, which a failed resolution does not. A run interrupted mid-merge is
  aborted by the script before the commit loop, so conflict markers are never committed either way.
- **The test command is the gate the design rests on.** A machine resolving a conflict unattended and then landing it is
  defensible because a resolution that does not pass the project's own tests does not land.
- **A conflict that still reaches a reader is one no machine could settle.** The row shows it as the failure's own
  text — which names the branch — beside the ordinary re-run control every other failed step offers. Understanding it is
  a user's job, with the diff in front of them.
- **Archive's cost and duration vary.** A run that meets no conflict is short and cheap; one that does is as big a
  piece of work as the resolution, under the same `timeoutSec.default` and model.

**`archive` is therefore the one step that can touch the worktree and fail to finish, and the generic commit loop
guards against that.** Every other step either succeeds or refuses before touching the tree. `archive` is handed an
open merge and can be interrupted (crash, cancellation, a timeout) after the merge opens but before the skill
commits or aborts it. Left alone, the script's generic `git add -A` + commit loop would stage the conflict markers and
commit them as the resolution. `core/scripts/aide-run-spec` aborts an unfinished merge before that loop runs, but only
when `command_name` is `archive` — every other step is unaffected. The "leaves the branch as it found it" contract for
a failed resolution therefore holds structurally, not only because the skill behaves well.

**Most of what `archive` does is a script, not an AI session.** `core/scripts/aide-archive-spec` resolves the spec
argument to a folder, checks whether a merge is open, and asks `core/scripts/lib/transitions.json` whether the spec
may move to `archived` — which asks whether `implement` has happened, not whether every step has. Then it stamps and
moves the folder, before any model is asked to. It reads the spec's own state file, falling back to `4-status.md`'s
`Workflow steps completed:` bullet, and never inspects a Phase table's Status cell. The two things that genuinely need judgment stay with the skill: resolving an actual merge conflict, and
deciding what documentation should outlive the spec (`core/skills/aide-archive/SKILL.md`'s Step 2). `aide-run-spec`
calls the same script once, right after worktree setup, purely to decide whether spawning `claude`/`codex` is worth
doing at all — its `terminalReason` of `not-implemented-yet` or `acceptance-criteria-unticked` skips the spawn entirely, the same "a
script decides success and reports it, no session runs" shape `already_landed()` has for a landed spec. Every other
outcome (`conflict-open`, `archived`) still spawns the model, because Step 2's doc-feedback judgment needs it whenever
the work is done, conflict or not.

**The script runs twice in one archive step, and that is by design.** `aide-run-spec`'s own pre-check may already have
moved the folder into `archive/` by the time the skill's own Step 1 calls the script again — idempotency is the guard,
not "call it once": a folder already under `archive/` is reported as `already-archived` (carrying the same
`specFolder`/`needsDocFeedback` the fresh `archived` outcome does, so Step 2 still runs) rather than moved, or
erroring, a second time.

## Origin decides whether a landing finished

The archive STEP can succeed while its landing fails: the folder moves into `archive/` before the code merge is even
attempted, so the job is `done` and the folder is archived with the code still on a branch. **A spec whose code did not
land is not finished, and its row has to say so.**

- **The archive landing asks origin, after merging.** One
  `git ls-remote --heads origin 'refs/heads/aide/*'` per repo root, cached for 30 seconds, asked fresh at the end of a
  landing because the merge has just deleted the branch it is about to ask about. A root that still holds
  `aide/<folder>` is a landing that did not finish, whatever the merge loop reported — and this catches every cause at
  once: a conflict, a repo the queue never knew about, history the LRU cap evicted, a push that half-succeeded.
- **It speaks only when the merge loop gave no reason of its own.** A row carries one reason. A conflict the loop
  reported is the row's sentence; the check's "still on origin — run archive again" is for the landing that reported ok
  while a branch stayed on origin, and beside a conflict it would contradict the sentence just given, once per root.
- **It is `archive`'s question and no other step's.** An `analyze`
  landing runs while implement's code branch is legitimately open, and the same check there would call a healthy landing
  failed.
- **A failed landing moves the job to `failed`.** Every page reads the state through one path, so it reads as unfinished
  wherever the job is shown. Downgraded only from `done`: the runner may have queued the job's NEXT step in between, and
  a landing must not overwrite a job that has moved on.
- **`errorReason` is `"conflict" | "held-back" | "tests-red" | "unlanded"`.** The class, beside the sentence a user reads — the row carries one
  sentence (several roots are named inside it; a second root's own failure goes behind it as hover detail), so nothing
  may match on it. Declared twice, in
  `src/queue/types.ts` and `src/render/ui/job-state/types.ts`, and pinned to each other by a test in `test/queue/requests/parsing-schedule-and-errors.test.ts` the way
  `PHASE_STEPS` is pinned to
  `RUN_STEPS`.
- **An unanswerable question invents nothing.** `ls-remote` that fails is `null`, and `null` claims neither that the
  branch is open nor that it is gone — the same fail-open rule `isMerged` keeps. A network blip must not report every
  archive as unlanded.
- **The spec keeps its row while its branch is open.** Every archived spec has a reader row on the specs list, but
  only on a chip that asks for one; a spec whose own `aide/<folder>` is still on origin is built whatever the
  chip, so it stays on the DEFAULT view — wearing the "not landed" mark, and counted by the Problems chip. The filter is
  the BRANCH,
  never the job's `errorReason`: a spec can reach this state with no reason recorded at all, and a stale reason on an
  old job would resurrect a row
  for a spec that is genuinely finished.
- **The way out is the step that already exists.** `archive` can be enqueued again for such a spec: `aide-run-spec`
  hands it the open merge, `/aide-archive`'s Step 1 resolves it, Step 2 still runs — `already-archived`
  carries the same `needsDocFeedback` a fresh archive does — and the landing that follows merges cleanly. A set that has not been refreshed yet is empty, so the enqueue fails closed.
- **What it does not do.** The Slack ping that already said "finished"
  is not withdrawn. The Runner starts the landing first and announces after, but it does not wait for the landing to
  settle, so the ping goes out while the merge is still in flight. And a page loaded in the
  second between
  `complete()` writing `done` and the landing settling still reads
  `done`; the correction arrives a moment later.

On the script's side, a re-run of `archive` has to find a folder that has already moved: `aide-run-spec` resolves
`--spec` for `archive` against the active folder first and `archive/` second — the same "try the active folder, then
`archive/`" pattern `aide_resolve_spec`, `resolve_dependency_folder` and `status_file_for` use
(`core/scripts/_aide-spec-lib.sh`, `core/scripts/aide-run-spec`) — gated on the candidate's branch still being on
origin. Not found falls through to the same "unknown spec" refusal, so a genuinely finished spec still refuses a
further `archive`.

## The tests run on the landing, once

The project's own test suite runs on the merged result before the push — in a throwaway worktree of that merge
commit rather than the live checkout, since a run's own git or a fast-forward of main can move the live checkout under
a running suite, changing the tests on disk while the code they import is already loaded. When
`git worktree add` itself fails, the gate falls back to the live checkout and says so in its log. The worktree
carries the project's `worktreeLinks` and its `.aide/config`, and is removed when the gate is over.
`mergeBranchIntoDefault` hands the merge to the landing gate (`src/serve/land-branch/test-gate.ts`), which asks
`aide-resolve-test-cmd` which command(s) the change calls for and runs them through `aide-record-test-run` (the
run's output goes to the gate log). A red run gets the whole command once more — a run that timed out does not — and
green on that second run lands like any green one, with the archived row reading "merged after a retry" and the
job keeping the lines the first run failed on (`testsGreenOnRetry`). Green pushes. Red on both runs drops the local merge with `reset --hard
origin/<base>`, nothing reaches origin, the branch stays where the step left it, and the job STOPS with
`errorReason: tests-red`, `stopReason: tests-red` and the sentence that says what to do — amber, not red: the step
ran and the merge was built, and what is missing is a green suite.

**A run the step already made is not made again.** A step that ended green reports what it saw green —
`testedGreen` on its result: the tree, hashed by `aide_tree_hash` with the project's worktree links left out, and
the commands. Only an `implement` reports one, since it is the one step that runs the suite. When the landing is about to run
exactly those commands on exactly that tree, it runs nothing, and the gate log says so
(`src/serve/land-branch/seen-green.ts`). Another tree — main moved — or other commands, and it runs as above.

This is the one place the suite runs for a change on its way to main after implement. The `archive` step runs none of
its own, whether or not its pull merged main in: the runner leaves it out, and a session resolving a conflict runs
only the tests covering the files it touched. `aide-archive-spec` checks the user's boxes and moves the folder, and runs
no tests.
A code root only: the specs root has nothing to run.

## A root that is no longer on disk

A landing carries every root the spec's older jobs ever named (`branchesFor`), and a root recorded before the
dashboard's files moved is not on disk any more. With another root still to land, the gone one is skipped with a
line in the serve log rather than failing the whole landing; a landing whose only root is gone still fails, since
nothing at all would land.

## A project can ask for its code branch to stay open

`codeLanding: pr` in the project's `.aide/project.yaml` — the tracked manifest, or the dashboard's untracked copy of
its `settings.yaml` — says this project's code is reviewed before it reaches the
default branch, and it does two things that must never be separated: the dashboard runs every one of that project's
steps with `--push pr`, so `aide-run-spec` opens the request, and `landBranch` skips `mergeBranchIntoDefault` for the
CODE root of an `archive` landing. Either half alone is worse than neither — a landing left open with nothing
describing it, or a pull request merged past moments after it was opened. Four things not to get backwards:

- **The manifest (tracked, or the dashboard's copy), never `.aide/config`.** Unlike `worktreeLinks`, there is no
  `.aide/config` fallback: whether code is
  reviewed is a team policy, and `.aide/config` is gitignored — a policy a fresh clone cannot read is not a policy.
  Absent, unrecognized or unparseable all resolve to `merge`.
- **The manifest is a DEFAULT for `--push`, never an override.** A `--push` typed at a terminal wins;
  `push_mode_explicit` in `aide-run-spec` is what tells "typed" from "left standing".
- **The CODE root only, and `archive` only.** The specs root keeps auto-merging in every mode — an archive commit
  moving a folder is bookkeeping, not a change anyone reviews — and `create`/`analyze` never reach a code root in the
  gated position. A specs root INSIDE the project is the same repository and therefore the same branch, so a
  single-repo project leaves its one branch open and that IS the pull request.
- **`errorReason` has no member for this.** A branch left open on purpose is a success; that pair classifies failures a
  user can act on. What splits instead is the WORDING of the branch-still-on-origin set: `prOpen`,
  computed by `peekUnlanded` in `src/serve/spec-lookup.ts`, is the subset that is open deliberately, and such a row
  says a pull request is waiting for review instead of wearing the "not landed" mark
  (`archivedRowNotices` in `src/render/pages/specs-list/row-marks.ts`). The set itself is the
  same, so the row stays on the list and `archive` stays enqueueable for it. `assessProjectReadiness` never looks at
  `codeLanding`: every value is valid to run with, so it is never a reason to refuse a run.
