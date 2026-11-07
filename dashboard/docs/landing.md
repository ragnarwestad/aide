# Branches and landing

## Table of contents

- [Branches, and merging them](#branches-and-merging-them)
- [Archive and implement resolve the conflict themselves](#archive-and-implement-resolve-the-conflict-themselves)
- [Origin decides whether a landing finished](#origin-decides-whether-a-landing-finished)
- [The tests run on the landing, once](#the-tests-run-on-the-landing-once)
- [A root that is no longer on disk](#a-root-that-is-no-longer-on-disk)
- [A project can ask for its code branch to stay open](#a-project-can-ask-for-its-code-branch-to-stay-open)

---

How each step's branch is merged into the default branch, what `archive` does when that merge conflicts, how origin
decides whether a landing finished, and how a project keeps its code branch open for review. The queue that makes the
branches is on [Running specs](running-specs.md). What a landing refusal says is the rule on
[Error sentences](error-sentences.md).

## Branches, and merging them

### One branch per repository

A job that touches two repositories makes a branch of the same name in both — `aide/89-merge-from-the-dashboard`
exists in the project and in the specs repo, with different contents and two separate compare pages. Merging one
does nothing for the other: each repo's branch is landed on its own, asked of that repo's own checkout.

A project whose specs live inside it has one repo and one branch for both. There, a step that lands no code —
`analyze`, `reopen`, `close`, and an `implement` sent back to a full analysis — copies the spec's own folder, and its `archive/` twin, from the branch onto the
default branch as one commit, and leaves every other path as it was. The branch stays open for the next step,
whose run merges the default branch in before it starts; a `close` deletes it afterwards.

### What each step lands

Nothing here is merged by hand. Every step lands its own work as it finishes, and there is no Merge button and no
Approve button: the step that made the work is what knows it is done. Leaving `archive` unticked is the inspection
point.

- `create` and `analyze` merge the branch they pushed into that repo's default branch, and leave the
  project's code root out.
- `implement` lands nothing. The code stays on the branch for anyone who wants to read or test it first. The one
  exception is an implement sent back to a full analysis in a project whose specs live inside the code root: it
  lands the spec's own folder, so main, the row and the next analyze have the Sent back line, and not its code.
- `archive` merges every repo it was told about: the roots its own run reported, plus the ones the queue's history
  recorded for the spec. **The code root goes first and the specs root last**, so a failed code merge stops the loop
  before the specs root, which carries the `Result: completed` stamp, is attempted. After a code root merges,
  `AIDE_INSTALL_CMD` runs.
- A stopped step other than `archive` lands what it pushed outside the code root. That covers a `timeout`,
  `provider-limit` or `shared-files` stop with something pushed and no code root among it. A stopped `implement` whose
  code branch was pushed lands nothing, and that code waits for `archive`. The exception is an implement sent back
  (`sent-back`) where the specs live inside the code root: it lands the spec's own folder alone. An `acceptance-criteria`
  stop lands nothing; the analysis stays on the spec's branch for the next Analyze. A landing that does run leaves the
  job's `error` in place, since it is the reason the step stopped.
- A stopped `archive` lands nothing. The spec stays active and its row offers Archive again; the folder reaches
  `archive/` on the default branch only when an archive step completes and lands.

The landing is the last step of the step's own skill, and the step is not finished until it is. The step's Log marks
it in the words of that skill's last heading:

- `--- Step 7 of 7: Merge into main — started` when the landing begins
- `— done` when every repo merged
- `— stopped: <why> — the archive is not finished`, an error line, when it did not

The titles are `MERGE_STEP` in `src/serve/land-branch/steps.ts`, one per step that lands (`create`, `analyze`,
`reopen`, `archive`, `close`).

Code reaches the default branch through `archive` alone. The landing can only merge the repos it knows about, so it
asks origin afterwards ([Origin decides whether a landing finished](#origin-decides-whether-a-landing-finished)).

### A merged branch is deleted

Once the merge is on origin, the landing deletes the branch, first on origin and then locally. A delete that fails is
never fatal: it is reported beside the merge.

### What is refused, and what is tried again

A landing merges the spec branch into each repo's default branch and pushes, one repo at a time:

- **A conflict refuses and names the repo and the files.** The files in conflict are read before the failed merge is
  aborted, so no half-merged tree is left behind; the sentence names five at most and how many more, and git's own
  lines are the detail.
- **A dirty tree decides nothing.** A file that genuinely collides raises git's own error.
- **A lost lock is not a conflict.** When git's stderr names a lock (`index.lock`, `packed-refs.lock`, a ref lock),
  the pull and the merge are retried up to five times, 400 ms apart.
- **A failed merge is tried again twice**, 700 ms and then 1400 ms after the first. A red test gate is not retried
  this way. Git's own words are kept as the row's detail.
- **A push that fails says why.** The push and the question to origin that follows a failed one get a minute each,
  not the four seconds every other git command gets, since a push killed at four seconds leaves no words at all. What
  git said is sorted as a run's own push is ([When a push fails or the base conflicts](the-runner.md#when-a-push-fails-or-the-base-conflicts),
  `gitError` in `src/format/git-error.ts`), and the refusal says it in the reader's language, with git's own lines,
  whole, as the detail.
- **Main moving under a landing is not a refusal.** When origin rejects the push because the default branch got
  commits while the tests ran, the branch is merged again onto the new base, the tests run again, and the push is
  made once more. A second rejection refuses, with the checkout level with origin.
- **A base ahead of origin is refused only when the commits are its own.** Merge commits and commits origin already
  holds, left by an interrupted landing, are not refused. Unpushed work of somebody's own on that branch is refused,
  by name.
- **A code merge can install.** The command is `AIDE_INSTALL_CMD` in the project's `.aide/config`, run in that
  checkout after its code merges, stopped after 120 seconds, and reported beside the merge. With it unset nothing
  runs, and the result says deploying is still a hand step. A failed install names the command and its exit code (or
  the time limit, or that it could not be started), and keeps the last eight lines it printed — stderr, else stdout —
  as the detail behind the (?).
- **The report is per repo, never one collective "ok".** One repo can succeed while another fails.

A landed folder becomes visible on the board when the shared checkout fast-forwards. When the landing is over, the
spec's cached git answers are read again, so no row is drawn from what was true before.

## Archive and implement resolve the conflict themselves

A spec's branch is brought up to date with the default branch before a step's own work starts. A step other than
`archive` and `implement` treats a conflict there as a user's problem: the merge is aborted and the run refuses with
`errorReason: "conflict"`. `archive` lands the branch, and `implement` writes its code, so a conflict is theirs to
settle. A `close` skips the code repository's branch, since it deletes that branch unmerged.

`core/scripts/aide-run-spec` hands `archive` and `implement` the worktree with the merge still open. A conflict
confined to this spec's own `4-status.md` it settles itself, the default branch's copy winning; the rest reaches the
skill, which follows `core/skills/aide-archive/references/resolve-conflict.md` before anything else: resolve it or
decide not to, finish the merge with `git commit --no-edit`, run the project's own test command. The step never
touches the default branch; the dashboard lands the resolved branch afterwards.

There is no `resolve` step and no Resolve button.

- **It names `archive` and `implement` literally, never a denylist.** Another step carrying conflict markers into a
  commit is worse than a refusal.
- **It either finishes or puts the branch back.** Tests red, or a conflict the skill will not decide, and the merge is
  undone to the commit the branch started on. That branch never reaches origin, since a root whose HEAD did not move is
  pushed only when the run ended `completed`.
- **The test command is the gate.** A resolution that does not pass the project's own tests does not land.
- **A conflict no machine could settle reaches the row** as the failure's own text, which names the branch, beside the
  ordinary re-run control.
- **An interrupted `archive` or `implement` commits no markers.** `aide-run-spec` aborts a merge still open before
  it commits, at the end of the step and on a Cancel.
- **`core/scripts/aide-archive-spec` decides and moves; the skill keeps only conflict resolution and doc feedback.**
  The script resolves the spec, asks `core/scripts/lib/transitions.json` whether it may move to `archived`, and moves
  the folder on the spec's branch. The move reaches the default branch only when the archive step completes and lands.
  `aide-run-spec` calls it once before the model: `not-implemented-yet` or `acceptance-criteria-unticked` skips the
  spawn.
- **The script runs twice in one archive step.** A folder already under `archive/` answers `already-archived`, with the
  same `needsDocFeedback` a fresh `archived` carries.
- **A re-run of `archive` finds a folder that has moved:** `--spec` is resolved against the active folder first and
  `archive/` second, while the branch is still on origin.

## Origin decides whether a landing finished

The archive STEP can succeed while its landing fails: the folder moves into `archive/` before the code merge is
attempted. **A spec whose code did not land is not finished, and its row says so.**

- **The archive landing asks origin, after merging**, with one `git ls-remote --heads origin 'refs/heads/aide/*'` per
  repo root. A root that still holds `aide/<folder>` is a landing that did not finish, whatever the merge loop
  reported.
- **It speaks only when the merge loop gave no reason of its own.** A row carries one reason.
- **It is `archive`'s question alone.** An `analyze` landing runs while implement's code branch is legitimately open.
- **A failed landing moves the job to `failed`**, only from `done`, as [A job's states](job-states.md) says.
- **An unanswerable question invents nothing.** A failed `ls-remote` claims neither that the branch is open nor that it
  is gone.
- **The spec keeps its row while its branch is open.** It stays on the default view of the specs list with the "not
  landed" mark, counted by the Problems chip. The filter is the BRANCH, never the job's `errorReason`.
- **A branch that merged is a cleanup, not a failure.** When the open `aide/<folder>` is an ancestor of origin's
  default branch in every root that holds it, the spec is archived, with an amber note that its branch is still on
  origin and a Delete branch button. An answer not in yet, or "not merged", reads "not landed". A closed spec's branch
  was never meant to merge, and its row is left as it was. For a project that reviews its code, a merged pull request
  counts as merged too: the sweep asks `gh pr list --head <branch>` for each archived spec whose branch is still on
  origin; a request still open wins over a merged one, and `gh` failing keeps the last answer.
- **Delete branch asks origin itself.** `POST /api/queue/specs/<project>/<spec>/delete-branch` asks each root fresh
  whether it holds the branch and whether it is merged, deletes nothing if any root is not merged, and deletes once per
  repository. A root git calls unmerged is accepted when the pull request merged and origin's tip is the head that
  merged. A closed spec, a spec that is not archived, a landing in the project or a job for the spec is refused.
- **The way out is the step that already exists.** `archive` can be queued again for such a spec; the landing that
  follows merges cleanly.
- **What it does not do.** The Slack ping that said "finished" is not withdrawn, and a page loaded between `done` being
  written and the landing settling still reads `done`.

## The tests run on the landing, once

The project's own test suite runs on the merged result before the push, in a throwaway worktree of that merge commit
that carries the project's `worktreeLinks` and `.aide/config`. When `git worktree add` fails, the gate runs in the live
checkout and says so in its log. The gate (`src/serve/land-branch/test-gate.ts`) asks `aide-resolve-test-cmd` which
commands the change calls for and runs them through `aide-record-test-run`.

- A red run gets the whole command once more, unless it timed out. Green on the second run lands, with the archived row
  reading "merged after a retry" and the job keeping the lines the first run failed on (`testsGreenOnRetry`).
- Red on both runs pushes nothing: the local merge is dropped, the branch stays where the step left it, and the job
  STOPS with `errorReason: tests-red` and `stopReason: tests-red`, amber and not red. The same commands then run once on
  the default branch alone (`redOnDefaultBranch`); red there too, the sentence says main is red as well, and archive
  merges the work once main is green again.
- Green on main alone, the sentence names the failing tests, read from the output by the same rules as a step's own
  run (`src/format/failing-tests.ts`, pinned to the runner's `failing-tests.sh` by
  `core/tests/fixtures/failing-tests.json`). The same tests on both runs: the merge broke them. Different tests on the
  two runs: that points to unstable tests or a busy machine, and only then does the sentence say to press Archive again
  when the machine is quieter. No test named: the sentence says the tests are red on the merge and green on main
  alone. Each outcome is a message in the board's catalogue, in the reader's language; the test output is the detail
  behind it, without the recorder's JSON line and cut at a line.
- The landing writes its test run into the step's Log, under "tests and commit": when it starts, green or red, the
  run once more, the run on main, and a run it skipped.

**A run the step already made is not made again.** An `implement` that ended green reports `testedGreen` on its
result: the tree, hashed by `aide_tree_hash` with the worktree links left out, and the commands. When the landing is
about to run exactly those commands on exactly that tree, it runs nothing and the gate log says so. Another tree or
other commands, and it runs as above.

This is the one place the suite runs for a change on its way to main after implement; `archive` runs none of its own.
A code root only: the specs root has nothing to run.

## A root that is no longer on disk

A landing carries every root the spec's older jobs ever named. A root recorded before the dashboard's files moved is
skipped with a line in the serve log when another root is still to land; a landing whose only root is gone fails.

## A project can ask for its code branch to stay open

`codeLanding: pr` in the project's `.aide/project.yaml` says this project's code is reviewed before it reaches the
default branch. It does two things that are never separated: every one of the project's steps runs with `--push pr`,
and the CODE root of an `archive` landing is not merged.

- **The manifest (tracked, or the dashboard's copy), never `.aide/config`.** Whether code is reviewed is team policy,
  and `.aide/config` is gitignored. Absent, unrecognized or unparseable resolve to `merge`.
- **It is a DEFAULT for `--push`, never an override.** A `--push` typed at a terminal wins.
- **The CODE root only, and `archive` only.** The specs root keeps auto-merging. A specs root INSIDE the project is the
  same repository and branch, so a single-repo project leaves its one branch open and that IS the pull request.
- **`errorReason` has no member for it.** A branch left open on purpose is a success. A row whose branch is open on
  purpose (`prOpen`, from `peekUnlanded` in `src/serve/spec-lookup.ts`) says a pull request is waiting for review,
  until it merges and the row offers Delete branch. The row stays on the list and `archive` stays queueable for it.
  `codeLanding` is never a reason to refuse a run.
