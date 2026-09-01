# Development in aide/dashboard

The queue, worktree, merge and archive internals: what a session working
under `dashboard/` has to know before changing them. Much of it also
documents `core/scripts/aide-run-spec`, the dashboard's execution backend
— a session editing that script directly should read this file by hand.
The behaviour itself is documented for readers in `docs/` (see the table
in the root `CLAUDE.md`); what follows is the set of things that are easy
to get backwards.

## What gets installed where

Everything is installed **globally** — not per project. Projects may also
have their own AI setup.

**Entry point:** `./install-all.sh` (repo root) installs all three AIs by
running each `implementations/<ai>/install.sh`. The `/install-all` skill
does the same. If you only want one AI, run its script directly (e.g.
`implementations/codex/install.sh`).

Each AI installer starts with `core/scripts/aide-preflight <tool>`, which
probes what is actually installed and reports where each piece will land
(informational only — a missing CLI never blocks the install).

Each AI installer is **self-contained**: it installs the shared scripts
(`core/scripts/` → `~/.local/bin/`) *and* its own AI-specific setup. The
shared script list is defined in one place — `core/scripts/_install-bin.sh`
— which each installer sources (`install_common_bin`). The list is
therefore copied multiple times during `install-all`, but maintained in
only one place.

The list: `aide-generate-pdf`, `aide-generate-html`, `aide-preflight`,
`aide-emit-run`, `aide-run-spec`, `validate-env`, `upgrade-ai-tools` and
the shared library `_aide-spec-lib.sh`. Two of them are opt-in and inert
until something invokes them: `aide-emit-run` (needs `AIDE_RUN_URL`; it is
both a `UserPromptSubmit` hook and the `--phase` reporter the
aide-implement skill calls) and `aide-run-spec` (one headless workflow
step — installing aide gives nobody a queue). Both are documented in the
README.

**Individual uninstallers never remove the shared scripts** — other AI
tools and the cron job depend on them. The same goes for the skills in
`~/.agents/skills/` (read by both Copilot and Codex, installed via
`core/scripts/_install-skills.sh`). Only `uninstall-all.sh` calls
`uninstall_common_bin` and `uninstall_agents_skills` (as its final steps).

**The PATH block in `~/.zshenv` and `~/.bashrc` follows that same
contract.** `install_shell_path` in `core/scripts/_install-bin.sh` writes a
marked, idempotent block putting `/opt/homebrew/bin`, `/usr/local/bin` and
`$HOME/.local/bin` on PATH; every installer calls it, and only
`uninstall-all.sh` calls `uninstall_shell_path`. It exists because
`ssh host 'command'` starts a NON-INTERACTIVE shell, which reads neither
`.zprofile`, `.zshrc` nor `.bash_profile`, so `tmux`, `claude` and
`tailscale` are "command not found" over ssh without it. Two things not to
change without knowing why: the block carries STABLE directories only (a
versioned path such as mise's bun install dir rots at the next upgrade,
which is why the deploy scripts name such tools by full path), and it is
PREPENDED to `~/.bashrc` while appended to `~/.zshenv` — most `.bashrc`
templates open with a non-interactive early return, so a block after it
would never run for the exact case this fixes.

## How a run touches the repositories

**`aide-run-spec` branches EVERY repo it touches, not just the project.**
An `analyze` step changes only the specs repo, so branching the project
alone would leave the analysis committed on `main` — the one thing
`push branch` exists to prevent. A repo whose HEAD did not move during
the run is not pushed at all, and the compare link is built from the
repos that actually changed (`branchUrls` in the result; `branchUrl`
keeps the single most interesting one). **HEAD movement is the test, not
`changedFiles`** — that field counts only what the run's own commit loop
found uncommitted, and a step that commits its own work (archive does)
leaves it at `0` with real commits on the branch.

**It branches them in `git worktree` checkouts of its own**, under
`$HOME/aide-worktrees/<project>/<spec>/`. The real checkouts are put back
**onto** their default branch before the worktrees are made and never
leave it, so several runs can go at once, the dashboard's spec list never
describes whatever branch a running job is on, and a person can use the
checkout meanwhile. Two consequences worth knowing before changing
anything here:

- The result's `repos[].root` is the MAIN checkout, not the directory the
  work happened in — the dashboard spawns git in that path after the run
  is over, and a worktree path is deleted when the run ends.
  `repos[].worktree` carries the throwaway one.
- A worktree carries tracked files only, so `.venv` and
  `dashboard/node_modules` reach it through `worktreeLinks:` in the
  COMMITTED `.aide/project.yaml` — symlinked in, and excluded from
  `git add -A` by pathspec, because a `dir/` gitignore rule does not match
  a symlink. `.aide/config`'s `AIDE_WORKTREE_LINKS` is still read when the
  manifest names none — the manifest wins where both do, and the run
  reports which file it read (`worktreeLinksSource` in the result blob,
  and a line on stderr).

**A run reaches the project and its specs root, and nothing else.** A
repo the run was not told about is not touched, and there is no flag to
name a third one. A spec that has to change two projects at once needs
that naming built, deliberately.

**`aide-run-spec` runs from a private copy of itself, and that is
load-bearing:** an `implement` step reinstalls aide, which copies the
script over itself while bash is still reading it by byte offset. The
copy's marker holds its own path and is unset before `claude` starts — a
bare exported flag would be inherited by `claude`, and the next nested
invocation would delete the installed script.

**`aide-run-spec`'s shebang finds `/bin/bash` on this machine, and that is
bash 3.2 — `mapfile` is bash 4 and is not available.** Anything added to
this script that wants an array built from multiple lines has to set it
via repeated `array+=(...)` instead.

## The hand-paired bash/TypeScript pairs

`core/scripts/aide-run-spec` and the dashboard make several of the same
decisions with no shared source. Each pair is pinned by a test that reads
both sides, so drift is caught — but the two copies still have to be
edited by hand together.

| Decision | bash | TypeScript | Pinned by |
|---|---|---|---|
| `WORKFLOW_STEPS` — the steps that exist | `aide-run-spec` | `dashboard/src/queue/steps.ts` | `test_aide_run_spec.py` |
| `DEPENDENCY_GATED_STEPS` — the steps an unarchived dependency holds back | `aide-run-spec` | `dashboard/src/serve/serve-helpers/config.ts` | `test_the_two_copies_of_the_dependency_gate_agree` |
| Project readiness — the read-only prerequisites a run needs | `aide-run-spec` | `assessProjectReadiness()` in `dashboard/src/project/project-admin/readiness.ts` | `tests/fixtures/project-readiness-prerequisites.json` |
| `worktreeLinks` precedence — manifest over `.aide/config` | `aide_manifest_get` + `aide-run-spec` | `resolveWorktreeLinks` in `dashboard/src/project/discover/config.ts` | `tests/fixtures/worktree-links-precedence.json` |
| `errorReason` — `"conflict" \| "unlanded"` | — | `dashboard/src/queue/types.ts` and `dashboard/src/render/ui/job-state/types.ts`, which do not import each other | `dashboard/test/queue/parsing-schedule-and-errors.test.ts` reads both as text |
| `codeLanding` — whether code is reviewed before it lands | one anchored `sed` in `aide-run-spec` | `resolveCodeLanding` in `dashboard/src/project/discover/config.ts` | `tests/fixtures/code-landing-precedence.json` |
| The status-mark rule — which Status cells count as done | `total_progress_for` in `aide-run-spec` | `isDoneMark` in `dashboard/src/project/parse-status.ts` | `tests/fixtures/status-row-counting.json` |

The workflow arc is a fourth copy of the step list: `WORKFLOW_ARC` in
`aide-run-spec`, `HISTORY_STEPS` in `dashboard/src/git/workflow-history.ts`
and `WORKFLOW_STEPS` in `dashboard/src/project/parse-status.ts` all name
the four stages `create`, `analyze`, `implement`, `archive`. Review is
part of `analyze`, not a stage: the three-reviewer routine runs inline
inside `core/skills/aide-analyze/SKILL.md`, between writing
`3-solution.md` and `4-status.md`, as separate Agent invocations blind to
the analyst's own reasoning.

Two known asymmetries in the readiness pair are named in that test's own
exclusion list rather than in the fixture: `specsRepo` is a check the
dashboard makes blocking that `aide-run-spec` does not refuse on, and
`dashboardCheckout` has no `aide-run-spec` counterpart at all.

`DEPENDENCY_GATED_STEPS` is `implement` and `archive`; the other steps run
regardless. "Merged" means ARCHIVED: the dependency's code lands when its
`archive` step runs, so that is when a dependent spec's held-back steps
are released. The dashboard's copy decides whether a queued job is PARKED
(left `queued` with the reason on its row); the script's copy decides
whether a run started by hand is REFUSED.

## Landing

**No step's work is merged by hand.** The dashboard lands each step's
branch when the step reports success — `create` and `analyze` merge into
the repo's default branch and delete the branch on origin; `implement`
lands nothing, so code waits on its branch until `archive`, which merges
every repo it was TOLD about (specs first, code last), runs
`AIDE_INSTALL_CMD` after a code root, and then archives. There is no Merge
or Approve button, no `gateAfter` and no `awaiting-approval` state; a
landing refused for a conflict leaves the branch and records
`errorReason: "conflict"` on the job. `landBranch` in
`dashboard/src/serve/land-branch/merge.ts` is the one place all of this
happens, under `mergeLock` per repo root.

**An `onLanded` callback runs before the runner clears its own job's
`landing` flag.** `Runner.complete()` in `dashboard/src/queue/runner.ts`
is synchronous: it starts the landing work (`onStepDone`, e.g.
`landArchivedSpec` for `archive`), writes `landing: true` onto the job's
own store row, and only clears that flag in a `.then()` once the WHOLE
landing promise settles — including whatever `onLanded` itself does. So a
callback that reads `queue.list()` sees its own triggering job still
marked `landing: true` even though the landing calling it has already
succeeded. Code in an `onLanded` callback that needs to know whether ITS
OWN job is still in flight cannot trust the stored `landing` flag for
that one row and must treat it as settled by hand — every other row's
`landing`/`inFlight` state is as trustworthy as ever.

**Origin decides whether an archive landing finished.** The merge loop can
only merge repos it was told about: its own run's `branchUrls`, plus what
`queue.branchesFor` remembers. A step run BY HAND, a job the LRU cap has
evicted, a push that half-succeeded — each leaves a branch no entry ever
mentioned. `archive`'s landing therefore ends by asking origin, fresh,
whether `aide/<folder>` is still in the project root or the specs root
(`BranchStatusChecker.openSpecBranches`), and a root that still holds it
is a landing that did not finish. Four things not to get backwards:

- **The check is `archive`'s alone, by the literal step name.** An
  `analyze` landing runs while implement's code branch is legitimately
  open, and the same check there would call a healthy landing failed.
- **A failed landing moves the job from `done` to `failed`, and only
  from `done`.** The step succeeded, so `complete()` has already written
  `done`; this promise settles afterwards. The runner may have queued the
  job's NEXT step in between, and a landing must not overwrite a job that
  has moved on.
- **An unanswerable `ls-remote` is `null`, and `null` claims nothing.**
  The same fail-open rule `isMerged` keeps.
- **The row is filtered on the BRANCH, never on the job's `errorReason`.**
  A spec can reach this state with no reason recorded at all, and a stale
  reason on an old job would resurrect a row for a spec that is genuinely
  finished.

The visible half is one set — archived specs whose own branch is still on
origin — with ONE reader: `dashboard/src/render/pages/queue-list.ts` draws
every archived spec as a reader row on the specs list, and such a spec's
row carries the "not landed" mark. That row is why the set is built on
the DEFAULT view, where the rest of the archive is not: a spec whose work
never landed has not finished, and the reading view is where that has to
be seen. The way out is the step that already exists — `archive` can be
enqueued again for such a spec, and `resolveProject` admits it only while
its branch is open. On the script's side, `aide-run-spec` resolves
`--spec` for `archive` against the active folder first and `archive/`
second — the same "try the active folder, then `archive/`" pattern
`aide_resolve_spec`, `resolve_dependency_folder` and `status_file_for`
use (`core/scripts/_aide-spec-lib.sh`, `core/scripts/aide-run-spec`) —
gated on the candidate's branch still being on origin. Not found falls
through to the same "unknown spec" refusal, so a genuinely finished spec
still refuses a further `archive`.

**A project can ask for its code branch to stay open.** `codeLanding: pr`
in the COMMITTED `.aide/project.yaml` says this project's code is reviewed
before it reaches the default branch, and it does two things that must
never be separated: the dashboard runs every one of that project's steps
with `--push pr`, so `aide-run-spec` opens the request, and `landBranch`
skips `mergeBranchIntoDefault` for the CODE root of an `archive` landing.
Either half alone is worse than neither — a landing left open with
nothing describing it, or a pull request merged past moments after it was
opened. Four things not to get backwards:

- **The manifest and NOTHING else.** Unlike `worktreeLinks`, there is no
  `.aide/config` fallback: whether code is reviewed is a team policy, and
  `.aide/config` is gitignored — a policy a fresh clone cannot read is not
  a policy. Absent, unrecognized or unparseable all resolve to `merge`.
- **The manifest is a DEFAULT for `--push`, never an override.** A
  `--push` typed at a terminal wins; `push_mode_explicit` in
  `aide-run-spec` is what tells "typed" from "left standing".
- **The CODE root only, and `archive` only.** The specs root keeps
  auto-merging in every mode — an archive commit moving a folder is
  bookkeeping, not a change anyone reviews — and `create`/`analyze` never
  reach a code root in the gated position. A specs root INSIDE the project
  is the same repository and therefore the same branch, so a single-repo
  project leaves its one branch open and that IS the pull request.
- **`errorReason` has no member for this.** A branch left open on purpose
  is a success; that pair classifies failures a person can act on. What
  splits instead is the WORDING of the branch-still-on-origin set:
  `prOpen` in `dashboard/src/serve/serve.ts` is the subset that is open
  deliberately, and `PR_OPEN` in
  `dashboard/src/render/pages/queue-list/row-shared.ts` is what such a row
  says instead of `NOT_LANDED`. The set itself is the same, so the row
  stays on the list and `archive` stays enqueueable for it.
  `assessProjectReadiness` never looks at `codeLanding`: every value is
  valid to run with, so it is never a reason to refuse a run.

## Archive

**A merge that fails is the merging step's problem, not a phase of its
own.** There is no `resolve` step. `update_branch_to_base()` in
`core/scripts/aide-run-spec` hands `archive` — and only `archive` — the
worktree with the merge OPEN (MERGE_HEAD set, the markers in the files)
where every other step aborts and refuses on the spot, and
`core/skills/aide-archive/SKILL.md`'s Step 1 follows
`references/resolve-conflict.md` before it does anything else. **The
condition is the literal string `archive`, never a denylist of the
others** — a step this got backwards would carry conflict markers into a
commit. The gate that makes a machine resolving a conflict unattended
defensible is the project's own test command: a resolution that does not
pass it puts the branch back where it was found, and nothing lands.

**`archive` is therefore the one step that can touch the worktree and
fail to finish, and the generic commit loop guards against that.** Every
other step either succeeds or refuses before touching the tree. `archive`
is handed an open merge and can be interrupted (crash, cancellation, a
budget stop) after the merge opens but before the skill commits or aborts
it. Left alone, the script's generic `git add -A` + commit loop would
stage the conflict markers and commit them as the resolution.
`core/scripts/aide-run-spec` aborts an unfinished merge before that loop
runs, but only when `command_name` is `archive` — every other step is
unaffected. The "leaves the branch as it found it" contract for a failed
resolution therefore holds structurally, not only because the skill
behaves well. A run that meets a conflict is as big a piece of work as
the resolution.

**Most of what `archive` does is a script, not an AI session.**
`core/scripts/aide-archive-spec` resolves the spec argument to a folder,
checks whether a merge is open, reads `4-status.md`'s
`Workflow steps completed:` bullet, and — when every step is there —
stamps and moves the folder, before any model is asked to. It never
inspects a Phase table's Status cell. The two things that genuinely need
judgment stay with the skill: resolving an actual merge conflict, and
deciding what documentation should outlive the spec
(`core/skills/aide-archive/SKILL.md`'s Step 2). `aide-run-spec` calls the
same script once, right after worktree setup, purely to decide whether
spawning `claude`/`codex` is worth doing at all — its `terminalReason` of
`not-implemented-yet` or `held-back` skips the spawn entirely, the same
"a script decides success and reports it, no session runs" shape
`already_landed()` has for a landed spec. Every other outcome
(`conflict-open`, `archived`) still spawns the model, because Step 2's
doc-feedback judgment needs it whenever the work is done, conflict or
not.

**The script runs twice in one archive step, and that is by design.**
`aide-run-spec`'s own pre-check may already have moved the folder into
`archive/` by the time the skill's own Step 1 calls the script again —
idempotency is the guard, not "call it once": a folder already under
`archive/` is reported as `already-archived` (carrying the same
`specFolder`/`needsDocFeedback` the fresh `archived` outcome does, so
Step 2 still runs) rather than moved, or erroring, a second time.
