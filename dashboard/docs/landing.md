# Branches and landing

How each step's branch is merged into the default branch, what `archive` does when that merge conflicts, how origin
decides whether a landing finished, and how a project keeps its code branch open for review. The queue that makes the branches is on [Running specs](running-specs.md). What a landing refusal has to say is the one rule on
[Error sentences](error-sentences.md).

## Table of contents

- [Branches, and merging them](#branches-and-merging-them)
- [Archive resolves the conflict itself](#archive-resolves-the-conflict-itself)
- [Origin decides whether a landing finished](#origin-decides-whether-a-landing-finished)
- [A project can ask for its code branch to stay open](#a-project-can-ask-for-its-code-branch-to-stay-open)

---

## Branches, and merging them

A job that touches two repositories makes a branch of the same name in both — `aide/89-merge-from-the-dashboard` exists
in the project and in the specs repo, with different contents and two separate compare pages. Merging one does nothing
for the other: each repo's branch is landed independently, asked of that repo's own checkout. A project whose specs
live inside it has one repo to land, not two — the same code path, not a special case.

The badge says what the reader needs, not merely what git answered. A flat "not merged" is a fact about the BRANCH
that reads as a verdict on the spec, and in the same amber while the step writing that branch
is still running. So while the spec's job is in flight the badge names what it is doing (`analyze running`), and once
nothing is running it says what is open and why — the one window that still exists being the code after
`implement` and before `archive`.

**Nothing here is merged by hand.** Every step lands its own work the moment it finishes: `create` and
`analyze`
merge the branch they pushed into that repo's default branch and delete it on origin; `implement` lands nothing, so the
code stays on the branch for anyone who wants to read or test it first; `archive`
merges every repo it was TOLD about — the roots its own run reported, plus the ones the queue's own history recorded for
the spec — the specs repo first, the code last, so the code is the last word — runs
`AIDE_INSTALL_CMD` after a code root, and then archives. It is not "every repo the
spec's branch exists in":
the loop can only merge what it knows about, which is why it ASKS ORIGIN afterwards, see
[Origin decides whether a landing finished](#origin-decides-whether-a-landing-finished). Leaving `archive`
unticked IS the inspection point. A landing that cannot be made (a conflict with the default branch) is refused by name
and the branch stays where it was — but
`archive` settles most of those itself before it gets that far, see
[Archive resolves the conflict itself](#archive-resolves-the-conflict-itself). A branch whose label is a known
project name is that project's code; a label that is not any project on this machine is the specs repo, which is a
closed set rather than a guess (`.claude/rules/development.md`: "the run only watches ... the roots it knows about").

There is no Merge button and no Approve button: the step that made the work is what knows it is done.

A landing merges the spec branch into each repo's default branch and pushes, one repo at a time:

- **A conflict refuses and names the repo.** The failed merge is aborted, so no half-merged tree is left behind — the
  same shape
  `aide-run-spec` already uses when it brings a reused branch up to date.
- **A dirty tree decides nothing.** A run does not dirty the main tree — it works in a worktree of
  its own and only ever fast-forwards this one — so a refusal over a dirty tree could only ever stop a merge over
  somebody's unrelated uncommitted file. The `switch`, `pull` and
  `merge` write nothing but what differs between the commits, and a file that genuinely collides raises git's own error
  instead of a guess made in advance. What the two sides can still collide over is git's `index.lock`, and there the run
  yields — its pull is a courtesy, recorded and never fatal.
- **`index.lock` is not a conflict.** Losing that race is not a diverged base and must not be refused with the same
  sentence. The pull is retried twice, a quarter
  of a second apart, and ONLY when git's own stderr names `index.lock`; every other failure is refused on the first
  attempt.
- **The plan lands first, the code last.** A run records the project before its specs root, so the merge order is
  reversed deliberately: the code is the one that matters, so it is the last word.
- **A code merge can install.** Merged is not deployed: for a project that installs itself somewhere, the default branch
  moving changes nothing on this machine. Set `AIDE_INSTALL_CMD` in that project's own
  `.aide/config` and it is run in that checkout after its code merges — argv, no shell, bounded by a timeout, and
  reported beside the merge rather than turning a completed merge into a failed one. Without the key nothing runs and
  the result says plainly that deploying is still a hand step. Either way the sentence reaches the page — in the same
  banner a refusal uses, whether the merge was posted from the page or by a plain form.
- **Conflicts are expected.** Two branches touching the same file conflict at merge time, and running several specs
  side by side makes it happen more often. Both sides refuse and name the repo rather than corrupting anything, and
  `archive` settles most of them itself (below).
- **The report is per repo, never one collective "ok".** Several repos cannot be merged atomically, and one succeeding
  while another fails is exactly what has to be readable.
- **Nothing is deleted.** A merged branch is still worth reading, and deleting is the one step that cannot be undone
  cheaply.

## Archive resolves the conflict itself

A spec's branch is brought up to date with the default branch before a step's own work starts, and every step but one
treats a conflict there as a person's problem: the merge is aborted and the run refuses on the spot with
`errorReason: "conflict"`. `archive` is the exception, because
`archive` is the step that LANDS the branch — a merge that fails is the merging step's problem, not a phase of its own.

So `core/scripts/aide-run-spec` hands `archive`, and only `archive`, the worktree exactly as git left it: `MERGE_HEAD`
set, the markers in the files. `/aide-archive`'s Step 1 checks for that and, when it finds it, follows
`core/skills/aide-archive/references/resolve-conflict.md` before anything else — read the conflict, resolve it or decide
not to, finish the merge with `git commit --no-edit`, run the project's own test command — and only then goes on to
archive the spec. The default branch is never touched by the step itself; the dashboard lands the resolved branch
afterwards, the way it lands any other step's work.

There is no `resolve` step and no Resolve button: a post naming `resolve` is refused as an invalid entry in `steps`,
and no control on the page draws off `errorReason`.

- **The condition is the literal string `archive`, never a denylist.**
  A step this got backwards would carry conflict markers into a commit, which is worse than a refusal.
- **It either finishes or puts the branch back.** Tests red, or a conflict the skill will not decide, and the merge is
  undone to the commit the branch started on. `aide-run-spec` pushes a repo only when its `HEAD` moved, so a branch put
  back never reaches origin — no new rollback machinery, the gate that already exists. A run interrupted mid-merge is
  aborted by the script before the commit loop, so conflict markers are never committed either way.
- **The test command is the gate the design rests on.** A machine resolving a conflict unattended and then landing it is
  defensible because a resolution that does not pass the project's own tests does not land.
- **A conflict that still reaches a reader is one no machine could settle.** The row shows it as the failure's own
  text — which names the branch — beside the ordinary re-run control every other failed step offers. Understanding it is
  a person's job, with the diff in front of them.
- **Archive's cost and duration vary.** A run that meets no conflict is short and cheap; one that does is as big a
  piece of work as the resolution, under the same `timeoutSec.default` and model.

**`archive` is therefore the one step that can touch the worktree and fail to finish, and the generic commit loop
guards against that.** Every other step either succeeds or refuses before touching the tree. `archive` is handed an
open merge and can be interrupted (crash, cancellation, a budget stop) after the merge opens but before the skill
commits or aborts it. Left alone, the script's generic `git add -A` + commit loop would stage the conflict markers and
commit them as the resolution. `core/scripts/aide-run-spec` aborts an unfinished merge before that loop runs, but only
when `command_name` is `archive` — every other step is unaffected. The "leaves the branch as it found it" contract for
a failed resolution therefore holds structurally, not only because the skill behaves well.

**Most of what `archive` does is a script, not an AI session.** `core/scripts/aide-archive-spec` resolves the spec
argument to a folder, checks whether a merge is open, reads `4-status.md`'s `Workflow steps completed:` bullet, and —
when every step is there — stamps and moves the folder, before any model is asked to. It never inspects a Phase table's
Status cell. The two things that genuinely need judgment stay with the skill: resolving an actual merge conflict, and
deciding what documentation should outlive the spec (`core/skills/aide-archive/SKILL.md`'s Step 2). `aide-run-spec`
calls the same script once, right after worktree setup, purely to decide whether spawning `claude`/`codex` is worth
doing at all — its `terminalReason` of `not-implemented-yet` or `held-back` skips the spawn entirely, the same "a
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
- **It is `archive`'s question and no other step's.** An `analyze`
  landing runs while implement's code branch is legitimately open, and the same check there would call a healthy landing
  failed.
- **A failed landing moves the job to `failed`.** Every page reads the state through one path, so it reads as unfinished
  wherever the job is shown. Downgraded only from `done`: the runner may have queued the job's NEXT step in between, and
  a landing must not overwrite a job that has moved on.
- **`errorReason` is `"conflict" | "unlanded"`.** The class, beside the sentence a person reads — the sentence is joined
  across repos before any page sees it, so nothing may match on it. Declared twice, in
  `src/queue/types.ts` and `src/render/ui/job-state/types.ts`, and pinned to each other by a test in `test/queue/parsing-schedule-and-errors.test.ts` the way
  `PHASE_STEPS` is pinned to
  `QUEUE_STEPS`.
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
  hands it the open merge, `/aide-archive`'s Step 1 resolves it, Step 2 stops because the folder has already moved, and
  the landing that follows merges cleanly. A set that has not been refreshed yet is empty, so the enqueue fails closed.
- **What it does not do.** The Slack ping that already said "finished"
  is not withdrawn — `announce` belongs to the Runner and fires before the landing exists. And a page loaded in the
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

The project's own test suite runs on the merged result, in the checkout the landing is about to push, before the
push — `mergeBranchIntoDefault` hands the merge to the landing gate (`src/serve/land-branch/test-gate.ts`), which asks
`aide-resolve-test-cmd` which command(s) the change calls for and runs them through `aide-record-test-run` (the
machine's test lock, the run's output in the gate log). Green pushes. Red drops the local merge with `reset --hard
origin/<base>`, nothing reaches origin, the branch stays where the step left it, and the job fails with
`errorReason: tests-red` and the sentence that says what to do. A red suite is never retried by the landing itself.

This is the one place the suite runs for a change on its way to main. `implement`'s own run during the step is the
model's TDD loop, not the gate; `aide-archive-spec` checks the person's boxes and moves the folder, and runs no tests.
A code root only: the specs root has nothing to run.

## A project can ask for its code branch to stay open

`codeLanding: pr` in the COMMITTED `.aide/project.yaml` says this project's code is reviewed before it reaches the
default branch, and it does two things that must never be separated: the dashboard runs every one of that project's
steps with `--push pr`, so `aide-run-spec` opens the request, and `landBranch` skips `mergeBranchIntoDefault` for the
CODE root of an `archive` landing. Either half alone is worse than neither — a landing left open with nothing
describing it, or a pull request merged past moments after it was opened. Four things not to get backwards:

- **The manifest and NOTHING else.** Unlike `worktreeLinks`, there is no `.aide/config` fallback: whether code is
  reviewed is a team policy, and `.aide/config` is gitignored — a policy a fresh clone cannot read is not a policy.
  Absent, unrecognized or unparseable all resolve to `merge`.
- **The manifest is a DEFAULT for `--push`, never an override.** A `--push` typed at a terminal wins;
  `push_mode_explicit` in `aide-run-spec` is what tells "typed" from "left standing".
- **The CODE root only, and `archive` only.** The specs root keeps auto-merging in every mode — an archive commit
  moving a folder is bookkeeping, not a change anyone reviews — and `create`/`analyze` never reach a code root in the
  gated position. A specs root INSIDE the project is the same repository and therefore the same branch, so a
  single-repo project leaves its one branch open and that IS the pull request.
- **`errorReason` has no member for this.** A branch left open on purpose is a success; that pair classifies failures a
  person can act on. What splits instead is the WORDING of the branch-still-on-origin set: `prOpen` in
  `src/serve/serve.ts` is the subset that is open deliberately, and `PR_OPEN` in
  `src/render/pages/queue-list/row-shared.ts` is what such a row says instead of `NOT_LANDED`. The set itself is the
  same, so the row stays on the list and `archive` stays enqueueable for it. `assessProjectReadiness` never looks at
  `codeLanding`: every value is valid to run with, so it is never a reason to refuse a run.
