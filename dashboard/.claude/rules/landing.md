---
paths:
  - "src/serve/land-branch/**"
  - "src/serve/runner-setup.ts"
  - "src/serve/setup/land.ts"
  - "src/serve/spec-views/**"
  - "src/git/branch-merge.ts"
  - "src/git/spec-folder-landing.ts"
  - "src/git/merge-hooks.ts"
  - "src/queue/runner/**"
  - "src/render/pages/specs-list/**"
  - "src/render/pages/spec-page/**"
  - "src/project/parse-status/**"
  - "test/serve/land-branch/**"
---

# Landing, archive and close

How a step's branch reaches main, and what the rows and pages that read
it may ask. Loaded for the code that lands a branch and for the code that
reads what a landing left.

## Landing

`docs/landing.md`, and `docs/job-states.md` for the job's side of it.

- **No step's work is merged by hand.** `landBranch` in
  `dashboard/src/serve/land-branch/merge.ts` is the one place a branch
  lands, under `mergeLock` per repo root. There is no Merge or Approve
  button, no `gateAfter`, no `awaiting-approval` state.
- **`implement` lands nothing, so no reader may ask the default branch
  whether it ran.** It falls through the landing dispatch by design
  (`runner-setup.ts`), and its `4-status.md` stays on its branch until
  archive merges it — so `SpecTarget.done`, which prefers the state file
  on the default branch, names `create, analyze` and no more while a spec
  waits on a tick. `historyDone` is the git-proved list, unlanded
  branches included, and it is what a question like "has implement run"
  reads (`archiveHeldBackApplies`). Asking `done` alone dropped the
  acceptance hold-back from every row waiting on one.
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
