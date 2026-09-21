# Development in aide/dashboard

What a session working under `dashboard/` has to know before changing the
queue, the worktrees, the landing or the archive step: the things that
are easy to get backwards. Each rule names the page in `docs/` that says
why. Much of this also governs `core/scripts/aide-run-spec`, the
dashboard's execution backend — a session editing that script directly
should read this file by hand.

## How a run touches the repositories

`docs/the-runner.md`, "How a run touches the repositories".

- `aide-run-spec` branches EVERY repo it touches, and pushes a repo only
  when its branch has content beyond its own default branch AND origin
  does not already hold that tip — never on `changedFiles`, which a step
  that commits its own work leaves at `0`, and never on "moved during
  THIS run" alone: a commit a prior run's failed push left stranded is
  retried on every later run, not only the run that made it (spec 343).
  A run's own bookkeeping (`Workflow steps completed`) is written and
  pushed as its own confirmed step, so it never lands while that push
  cannot be confirmed against origin (spec 343).
- It works in `git worktree` checkouts under
  `$HOME/.aide/dashboard/worktrees/<project>/<spec>/`. The result's `repos[].root` is
  the MAIN checkout; `repos[].worktree` is the throwaway one.
- Gitignored paths reach a worktree only through `worktreeLinks:` in the
  manifest; `.aide/config`'s `AIDE_WORKTREE_LINKS` is the fallback, and the
  manifest wins. A project that does not track a manifest keeps its
  settings in the dashboard's `checkouts/<name>/settings.yaml`; the
  clone, a step's worktree and the landing's tree carry an untracked copy
  of it as `.aide/project.yaml`, kept out of every commit and out of
  `aide_tree_hash`. A tracked manifest always wins.
- A run reaches the project and its specs root, and nothing else — and
  under the specs root only its own folder (and its `archive/` twin):
  a step that writes another spec's folder ends `scope-violation`, with
  those changes discarded before the commit. `create` is the one step
  that makes a folder.
- The script runs from a private copy of itself — an `implement` step
  reinstalls it under bash's feet — and `/bin/bash` here is 3.2: no
  `mapfile`, build arrays with `array+=(...)`.
- **An `implement` ends only on a green test run the runner made itself**
  (`run-spec-step-tests.sh`): the session's own record is never what
  decides. Red goes back to the same session first, as a follow-up turn
  with the failing lines — at most `AIDE_TEST_FIX_ROUNDS` (2) more, each
  within what is left of the step's time limit — claude through
  `-p --resume`, codex through `codex exec resume <thread> -`.
  Still red is `terminalReason: tests-red` on the STEP — a failed job
  with the failing lines as detail, and Implement offered again — unlike
  the landing's `tests-red`, which STOPS the job. `run_model_turn`
  (`run-spec-spec-paths.sh`) is the one turn; every turn of a step
  appends to the same transcript. An `archive` runs no suite of its own,
  merged with main or not: its landing runs the suite once, on exactly
  what main is about to become, and that is the one run an archive
  gets. A green
  `test-run.json` whose `tree` (`aide_tree_hash`, `_aide-spec-lib.sh`)
  is the delivered tree's, naming the resolved commands, IS the runner's
  run — the suite is not run again for it, before the first run or after
  a fix turn; a record without a tree is the session's word and never
  counts. The tree hash leaves the project's worktree links out, so it is
  the tree the commit carries, and a landing about to run the same
  commands on the same tree skips its own run (`testedGreen`,
  `land-branch/seen-green.ts`).
- Every move of a shared checkout — the pull (switch, fetch,
  fast-forward) and the worktree add — runs under the per-root lock
  `$root/.git/aide-run-spec-worktree.lock` (`acquire_worktree_lock`,
  `run-spec-gates.sh`). Runs of one project share its checkout, and a
  git command that moves it outside the lock loses a ref lock or the
  checkout under its feet when another run is in its own section.
  A refusal from such a command quotes git's own first line.

## The dashboard's own checkouts

`docs/projects.md`, "Adding a project".

- **A clone happens on a press and nowhere else.** `ensureDashboardCheckout`
  clones only when its caller passes `mayClone` — Add, and any
  successful Settings save of the project, whichever field it changed. Every tick, boot and page render asks
  without it and is told what is missing; `CheckoutEnsurer.make()` is
  the one entry that may clone, and `get`/`fresh` never do.
- **Nothing here deletes a checkout, and nothing re-clones one to repair
  it.** A directory that is there and that git cannot answer for is
  reported by project at the top of every page
  (`render/ui/checkout-faults.ts`), in the dashboard's own sentence —
  git's own words appear only for a clone that failed — and left alone. A checkout that IS
  the project's own entry gets its own sentence, because the advice
  "remove it by hand" would be advice to delete the project.
- **A project is added by its git address, so no directory already on
  the host is ever registered.** Where the clone lands depends on the
  projects root. On the directory of links a serving host uses, the
  entry is a link to the dashboard's own checkout, so `personDir` and
  that checkout are one directory. On an ordinary projects root, Add
  clones into `<projects root>/<name>` and then makes the dashboard's own
  checkout as a second clone of the same origin, so they are two.

## The hand-paired bash/TypeScript pairs

`core/scripts/aide-run-spec` and the dashboard make several of the same
decisions with no shared source. Each pair is pinned by a test that reads
both sides, so drift is caught — but the two copies still have to be
edited by hand together. Three further decisions look like such pairs but
share one source file each — the workflow's own vocabulary, the effort
levels, and whether a spec may move from one phase to another — so those
three are never hand-paired; each carries a runtime assertion instead of
a test that reads two sides.

`docs/bash-typescript-decisions.md` has the full table, the two known
asymmetries in the readiness pair, and the three shared-source decisions
with the tests and assertions that pin all of them.

- **The landing runs Aide's scripts from beside `--runner-bin`, never from
  PATH alone** (`scriptFor` in `land-branch/run-script.ts`). A test board
  serving a branch runs that branch's TypeScript, and the bash written
  together with it lives in the same checkout; the copy under
  `~/.local/bin` is main's, so a flag the branch added is "unknown" to
  it. Prod's runner IS the installed one, so prod is unchanged.
  `test/serve/land-branch/scripts-beside-the-runner.test.ts` pins the
  lookup and the wiring.

## Landing

`docs/landing.md`, and `docs/job-states.md` for the job's side of it.

- **No step's work is merged by hand.** `landBranch` in
  `dashboard/src/serve/land-branch/merge.ts` is the one place a branch
  lands, under `mergeLock` per repo root. There is no Merge or Approve
  button, no `gateAfter`, no `awaiting-approval` state.
- **An `onLanded` callback runs before its own job's `landing` flag is
  cleared**, so it cannot trust that one row's flag and must treat it as
  settled by hand — `docs/job-states.md`, "Beside the state".
- **An `archive` lands on `terminalReason: "completed"` alone.** A
  refusal from `aide-archive-spec` (`not-implemented-yet`,
  `acceptance-criteria-unticked`) is `ok` and the job is `done` — the
  row reads "archive held back" from `4-status.md` — but nothing was
  archived, and `already-landed` has nothing left to land. Neither
  reaches `landArchivedSpec`; landing a refusal merged implement's code
  branch into main with the spec still active.
- **Two `archive` steps never run at once in one project.** Both branch
  from the code root's main and both land into it; the second is held
  `queued` with the reason on its row until the first has landed — the
  same shape as the two hold-backs beside it in `Runner.tick()`. "Has
  landed" includes the landing itself: a job whose archive step ended
  reads `done` with `landing` set while its branch is merged, and an
  archive started in that window brings its branch up to a main the
  merge has not reached yet. An analyze or implement landing moves the
  specs repository alone and holds nothing — `landStepBranch` leaves the
  code root out even when the run's own catch-up merge moved it. Where
  the specs live inside that root, an analyze, reopen or close
  landing copies the spec's own folder onto main and nothing else of the
  branch (`landSpecFolderOnly`, `git/spec-folder-landing.ts`, chosen in
  `handed-to-merge.ts`): code reaches main through `archive` alone.
- **Origin decides whether an `archive` landing finished.** It asks
  whether `aide/<folder>` is still on origin, and a root that holds it is
  a landing that did not finish. The check is `archive`'s alone, by the
  literal step name; a failed landing moves the job to `failed` and ONLY
  from `done`; an unanswerable `ls-remote` is `null` and claims nothing;
  the "not landed" row is filtered on the BRANCH, never on `errorReason`;
  and it adds its sentence only when the merge loop reported no failure
  of its own — one reason per row.
- **A landing the project's suite refused STOPS the job, it does not fail
  it.** `errorReason: tests-red` takes the `landing-held` transition to
  `stopped` with `stopReason: tests-red`, and the row's mark is amber and
  reads "tests red": the step ran and the merge was built, and what is
  missing is a green suite. Every other landing failure stays red.
- **`codeLanding: pr` keeps the CODE root's branch open** on an `archive`
  landing and runs every step with `--push pr`; the two halves are never
  separated. The manifest is a DEFAULT for `--push`, never an override;
  the specs root keeps auto-merging; `errorReason` has no member for it —
  `prOpen`/`PR_OPEN` split the wording instead.
- **`StepResult.at` is absent until a landing step's merge settles**, not
  from the moment its own process exits — `Runner.complete()` defers the
  stamp so a phase's own duration keeps counting through the merge. Any
  new reader of `Job.results[]` has to treat `at` as optional; a
  standalone type that copies `StepResult`'s shape by hand (rather than
  reusing it) needs the same optionality, or `tsc --noEmit` only catches
  the mismatch once something is assigned into it.

## Signalling a process group

- **`process.kill(-pid)` is written in one file: `serve-helpers/signal-group.ts`.**
  `signalGroup`/`signalProcess` refuse any pid below 2, because `-1` is
  every process the user owns — the served dashboard, the terminal, the
  browser, the login session. A record that says `wrapperPid: 1` or
  `pgid: 0` is dropped, never signalled. `test/serve/signal-group.test.ts`
  fails on a second `process.kill(-` anywhere under `src`, and every test
  file whose fixtures carry made-up pids spies `process.kill` for the
  whole file.

## Archive

`docs/landing.md`, "Archive resolves the conflict itself".

- **A conflict is `archive`'s to resolve, by the literal string
  `archive`, never a denylist.** `update_branch_to_base()` hands it the
  worktree with the merge OPEN; every other step aborts and refuses.
  `aide-run-spec` aborts an unfinished merge before its generic commit
  loop, for `archive` only, so conflict markers are never committed. The
  landing's test gate (`docs/landing.md`, "The tests run on the landing,
  once") is what stops a resolution that breaks the suite: red drops the
  merge, and nothing lands.
- **`core/scripts/aide-archive-spec` decides and moves; the skill keeps
  only conflict resolution and doc feedback.** It runs twice in one step
  by design, and `already-archived` is the idempotent second answer.
- **A re-run of `archive` finds a folder that has moved:** `aide-run-spec`
  resolves `--spec` against the active folder first and `archive/` second,
  gated on the branch still being on origin.

## Close

A spec whose idea did not hold (spec 406) — a fourth member of the
archive/reopen family, with its own phase (`closed`) rather than
reusing `archived`'s. `core/scripts/aide-close-spec` is `aide-archive-spec`'s
stamp-and-move tail without its `not-implemented-yet`/`acceptance-criteria-
unticked` gates: Close is legal from every phase Archive would refuse.

- **The code root's branch is deleted, never merged.** `landClosedSpec`
  (`land-branch/steps.ts`) lands like `landArchivedSpec`, but
  `landBranch`'s own `discard(root)` (`land-branch/merge.ts`) routes the
  code root to `deleteBranchOnly` (`git/branch-merge.ts`) instead of
  `mergeBranchIntoDefault` — steps 1, 7 and 8 of that function alone, no
  merge, no gate, no push. The specs root still merges normally, carrying
  the folder move and the `**Closed:**` stamp into the specs repo's own
  history. Specs inside the code root have no specs root of their own:
  there the folder is copied onto main first, then the branch deleted.
- **A discarded root reports and installs nothing.** `RepoMergeResult.discarded`
  is what tells `landBranch`'s per-repo success branch a root was deleted
  rather than merged — the merge-events report and `installAfterMerge`
  both skip it; a failed branch delete is still recorded through the same
  `branchDeleteError` archived specs already carry.
- **`closed` reads distinctly from `archived` everywhere a spec's state is
  shown** (REQ-7): `SpecRef.closed` (off the `**Closed:**` stamp), the
  specs list's own `CLOSED_STATE` (excluded from both the Archived and
  Active filters), and the spec page's `closedLine` in place of
  `archivedLine`. `isArchivedRow` (specs-list) is widened to include it —
  every caller's real question is "is this row locked", true of a closed
  row the same way.

## Starting a script

- **A script is started through its own interpreter, never exec'd
  directly** (`scriptArgv`, `src/integrations/script-argv.ts`). macOS
  checks a freshly written executable for 10-13 seconds the first time it
  is exec'd, once per new file; every install and every test stub is one.
  A test that puts a stub on PATH for a bash script to call hands it down
  as an exported function (`BASH_FUNC_<name>%%`) instead of a file, and a
  stub that must be a file is written once per test file, not per test.

## Code health

The dashboard's own source keeps these limits, checked by
`test/design/code-health-limits.test.ts`:

- A source file under `src/` stays at or under 500 lines. `messages.ts`,
  `en.ts` and `nb.ts` are exempt by filename — the message catalogues
  grow with every new string.
- A test file stays at or under 800 lines.
- A directory holds at most 15 `.ts` files directly inside it, with no
  exceptions: the six that were over it are grouped into subdirectories
  now, and the list of exceptions is gone. A new `.ts` file that would
  take a directory past 15 goes in a subdirectory of it instead, named
  for what those files are about — `test/e2e/phone/`, `test/serve/schedule/`.
  A moved test's own imports gain one `../`.
- As a rule, a source file's tests live under the matching path in
  `test/` — the test for `src/queue/store/index.ts` belongs under
  `test/queue/`. A small, tightly-coupled file may keep its test beside
  it instead, as `src/i18n/`'s own catalogue files already do.
- A module split across several files is a directory named after the
  module, holding an `index.ts` — never a file sitting beside a
  directory of the same name. `src/render/pages/spec-page/index.ts`,
  not `spec-page.ts` next to `spec-page/`.

- No `<name>-e` twin sits beside a file under `src/` or `test/`. macOS
  `sed -i -e ...` reads `-e` as the backup suffix and leaves the original
  under that name; the copy still parses, so nothing fails and nothing
  says so.

A file nearing a limit is split by responsibility, not by size — pull
out the part that has its own name, not an arbitrary half. New
functionality goes into its own file rather than being appended to one
that already holds something else.
