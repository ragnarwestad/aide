# Development in aide

## Repo layout

**`dashboard/` came in with `git subtree add`, and its history is only
reachable through `git blame`.** `git log --follow -- dashboard/<file>`
and plain `git log -- dashboard/<file>` stop at the import commit and
show nothing older — that is how subtree boundaries work, not a sign the
move went wrong. `git blame dashboard/src/discover.ts` does attribute
every line to its original pre-merge commit and author. Measured on a
throwaway repo before the move and confirmed after (spec 85). The
standalone `aide-dashboard` repo is kept as a fallback but no longer
carries a manifest, so it is not a project in its own right anymore.

**Two toolchains, deliberately separate.** The repo root is pytest
(`pytest.ini`, no lockfile); `dashboard/` is bun + TypeScript
(`dashboard/bun.lock`). Project-command detection reads the ROOT only, so
aide's test command stays `pytest` — a `package.json` at the root would
silently redirect it, which
`tests/specs/unit/core/validation/test_dashboard_merge.py` guards
against. Run the dashboard's own suite from inside `dashboard/`:
`bunx tsc --noEmit && bun test`.

## What gets installed where

Everything is installed **globally** — not per project. Projects may also
have their own AI setup.

**Entry point:** `./install-all.sh` (repo root) installs all three AIs by
running each `implementations/<ai>/install.sh`. The `/install-all` skill does the
same. If you only want one AI, run its script directly (e.g.
`implementations/codex/install.sh`).

Each AI installer starts with `core/scripts/aide-preflight <tool>`, which
probes what is actually installed and reports where each piece will land
(informational only — a missing CLI never blocks the install).

Each AI installer is **self-contained**: it installs the shared scripts
(`core/scripts/` → `~/.local/bin/`) *and* its own AI-specific setup. The
shared script list is defined in one place — `core/scripts/_install-bin.sh` — which
each installer sources (`install_common_bin`). The list is therefore copied
multiple times during `install-all`, but maintained in only one place.

The list today: `aide-generate-pdf`, `aide-generate-html`, `aide-preflight`,
`aide-emit-run`, `aide-run-spec`, `validate-env`, `upgrade-ai-tools` and the
shared library `_aide-spec-lib.sh`. Two of them are opt-in and inert until
something invokes them: `aide-emit-run` (needs `AIDE_RUN_URL`; it is both a
`UserPromptSubmit` hook and the `--phase` reporter the aide-implement skill
calls) and `aide-run-spec` (one headless workflow step — installing aide
gives nobody a queue). Both are documented in the README.

**`aide-run-spec` branches EVERY repo it touches, not just the project.**
An `analyze` step changes only the specs repo, so branching the project
alone left the analysis committed on `main` and pushed there — the one
thing `push branch` exists to prevent. A repo whose HEAD did not move
during the run is not pushed at all, and the compare link is built from
the repos that actually changed (`branchUrls` in the result;
`branchUrl` keeps the single most interesting one). **HEAD movement is
the test, not `changedFiles`** — that field counts only what the run's
own commit loop found uncommitted, and a step that commits its own work
(archive does) leaves it at `0` with real commits on the branch. Gating
the push on it left spec 92's archive branch on the serving host only,
with the result reporting success.

**It branches them in `git worktree` checkouts of its own** (spec 91),
under `$HOME/aide-worktrees/<project>/<spec>/`. The real checkouts are
put back **onto** their default branch before the worktrees are made and
never leave it, so several runs can go at once, the dashboard's spec list
stops describing whatever branch a running job is on, and a person can
use the checkout meanwhile. Two consequences worth knowing before
changing anything here:

- The result's `repos[].root` is the MAIN checkout, not the directory the
  work happened in — four places on the dashboard spawn git in that path
  after the run is over, and a worktree path is deleted when the run
  ends. `repos[].worktree` carries the throwaway one.
- A worktree carries tracked files only, so `.venv` and
  `dashboard/node_modules` reach it through `worktreeLinks:` in
  `.aide/project.yaml` — symlinked in, and excluded from `git add -A` by
  pathspec, because a `dir/` gitignore rule does not match a symlink.
  In the COMMITTED manifest since spec 184: `.aide/config` is dropped by
  a global ignore rule, so the shareable half of it was lost every time
  the project met a new machine. `.aide/config`'s `AIDE_WORKTREE_LINKS`
  is still read when the manifest names none — the manifest wins where
  both do, and the run reports which file it read (`worktreeLinksSource`
  in the result blob, and a line on stderr). This is a FOURTH hand-paired
  bash/TypeScript pair after `WORKFLOW_STEPS`, `DEPENDENCY_GATED_STEPS`
  and project readiness: `aide_manifest_get` + `aide-run-spec` on one
  side, `resolveWorktreeLinks` in `dashboard/src/discover.ts` on the
  other, pinned to each other by
  `tests/fixtures/worktree-links-precedence.json` — one table, four
  combinations, read by a test on each side.

**`WORKFLOW_STEPS` is duplicated with no shared source — a new step
needs both copies.** `core/scripts/aide-run-spec`'s bash list and
`dashboard/src/queue.ts`'s TypeScript array must name the same steps or
the dashboard offers a step the script refuses (or the reverse). A
regression test (`test_aide_run_spec.py`) reads both lists and asserts
they match — add a step to only one and that test catches it, but the
two lists themselves still have to be edited by hand together (spec
106; the gap was already flagged at spec 91).

**Project readiness is a third instance of that same shape, and this one
has no paired test at all.** `dashboard/src/project-admin.ts`'s
`assessProjectReadiness()` mirrors, in TypeScript, the read-only
prerequisites `core/scripts/aide-run-spec` itself enforces before a run
starts — resolvable default branch, worktree-link sources that exist.
The two are kept in sync by hand; unlike `WORKFLOW_STEPS` and
`DEPENDENCY_GATED_STEPS`, no test reads both sides and asserts they
agree (spec 138). A change to one of the runner's prerequisites needs a
matching change in `assessProjectReadiness()`, checked by inspection
until a shared-source test exists. Spec 144 is what that costs when it
is forgotten in the other direction: a clean tree was on both lists,
the runner stopped requiring one, and a readiness check left behind
would have gone on warning about a refusal that no longer happens.

**`DEPENDENCY_GATED_STEPS` is the second list of that shape (spec 122),
and it works the same way.** `implement` and `archive` are the steps
an unmerged dependency holds back; the other steps run
regardless. Since spec 149 "merged" means ARCHIVED: the dependency's
code lands when its `archive` step runs, so that is when a dependent
spec's held-back steps are released. The bash string in `core/scripts/aide-run-spec` and the
TypeScript array in `dashboard/src/serve.ts` are pinned to each other by
`test_the_two_copies_of_the_dependency_gate_agree`, and are edited by
hand together exactly as `WORKFLOW_STEPS` is. The dashboard's copy is
what decides whether a queued job is PARKED (left `queued` with the
reason on its row until the dependency merges); the script's copy is
what decides whether a run started by hand is REFUSED.

**No step's work is merged by hand (spec 149).** The dashboard lands
each step's branch when the step reports success — `create` and
`analyze` merge into the repo's default branch and delete the
branch on origin; `implement` lands nothing, so code waits
on its branch until `archive`, which merges every repo it was TOLD
about (specs first, code last), runs `AIDE_INSTALL_CMD`
after a code root, and then archives. There is no Merge or Approve button, no `gateAfter` and
no `awaiting-approval` state; a landing refused for a conflict leaves
the branch and records `errorReason: "conflict"` on the job.
`landBranch` in `dashboard/src/serve.ts` is the one place all of this
happens, under `mergeLock` per repo root.

**"Every repo the spec's branch still exists in" was the intent, never
the code — so origin is asked (spec 193).** The merge loop can only
merge repos it was told about: its own run's `branchUrls`, plus what
`queue.branchesFor` remembers. A step run BY HAND, a job the LRU cap
has evicted, a push that half-succeeded — each leaves a branch no entry
ever mentioned, and three specs reached the archive that way with their
code unmerged and every row saying done. `archive`'s landing therefore
ends by asking origin, fresh, whether `aide/<folder>` is still in the
project root or the specs root
(`BranchStatusChecker.openSpecBranches`), and a root that still holds
it is a landing that did not finish. Four things not to get backwards:

- **The check is `archive`'s alone, by the literal step name.** An
  `analyze` landing runs while implement's code branch is legitimately
  open, and the same check there would call a healthy landing failed —
  constantly, which is worse than the bug it fixes.
- **A failed landing moves the job from `done` to `failed`, and only
  from `done`.** The step succeeded, so `complete()` has already
  written `done`; this promise settles afterwards. The runner may have
  queued the job's NEXT step in between, and a landing must not
  overwrite a job that has moved on.
- **An unanswerable `ls-remote` is `null`, and `null` claims nothing.**
  The same fail-open rule `isMerged` keeps.
- **`errorReason` is a FIFTH hand-paired pair** after `WORKFLOW_STEPS`,
  `DEPENDENCY_GATED_STEPS`, project readiness and `worktreeLinks`:
  `"conflict" | "unlanded"` is declared in `dashboard/src/queue.ts` and
  again in `dashboard/src/render/job-state.ts`, which do not import each
  other. `dashboard/test/queue.test.ts` reads both declarations as text
  and asserts they name the same members.

The visible half is one set — archived specs whose own branch is still
on origin — and since spec 221 it has ONE reader:
`dashboard/src/render/queue-list.ts` draws every archived spec as a
reader row on the specs list, and such a spec's row carries the "not
landed" mark. `dashboard/src/render/archive-page.ts` was the second
reader and is gone with the `/archive` page it drew. The row is the
reason the set is still built on the DEFAULT view, where the rest of
the archive is not: a spec whose work never landed has not finished,
and the reading view is where that has to be seen. It is filtered on
the BRANCH and never on the job's `errorReason`: spec 146 carried no
reason at all, and a stale reason on an old job would resurrect a row
for a spec that is genuinely finished. The way out is
the step that already exists — `archive` can be enqueued again for such
a spec, and `resolveProject` admits it only while its branch is open.

**A project can ask for that branch to stay open (spec 220).**
`codeLanding: pr` in the COMMITTED `.aide/project.yaml` says this
project's code is reviewed before it reaches the default branch, and it
does two things that must never be separated: the dashboard runs every
one of that project's steps with `--push pr`, so `aide-run-spec` opens
the request, and `landBranch` skips `mergeBranchIntoDefault` for the
CODE root of an `archive` landing. Either half alone is worse than
neither — a landing left open with nothing describing it, or a pull
request merged past moments after it was opened. Five things not to get
backwards:

- **It is a SIXTH hand-paired pair**, after `WORKFLOW_STEPS`,
  `DEPENDENCY_GATED_STEPS`, project readiness, `worktreeLinks` and
  `errorReason`: `resolveCodeLanding` in `dashboard/src/discover.ts`
  reads the key with `parseManifest`, and `core/scripts/aide-run-spec`
  reads it with one anchored `sed` to default its own `--push`.
  `tests/fixtures/code-landing-precedence.json` is the table both sides
  are checked against — one file, six combinations, read by a test on
  each side.
- **The manifest and NOTHING else.** Unlike `worktreeLinks`, there is no
  `.aide/config` fallback: that one exists only because
  `AIDE_WORKTREE_LINKS` predates the manifest and both spellings had to
  keep working. Whether code is reviewed is a team policy, and
  `.aide/config` is gitignored — a policy a fresh clone cannot read is
  not a policy. Absent, unrecognized or unparseable all resolve to
  `merge`, which is what every project did before this existed.
- **The manifest is a DEFAULT for `--push`, never an override.** A
  `--push` typed at a terminal wins; `push_mode_explicit` in
  `aide-run-spec` is what tells "typed" from "left standing", which the
  `worktreeLinks` precedence never had to do because no flag competed
  with it.
- **The CODE root only, and `archive` only.** The specs root keeps
  auto-merging in every mode — an archive commit moving a folder is
  bookkeeping, not a change anyone reviews — and `create`/`analyze`
  never reach a code root in the gated position. A specs root INSIDE the
  project is the same repository and therefore the same branch, so a
  single-repo project leaves its one branch open and that IS the pull
  request.
- **`errorReason` did NOT grow a member for this.** A branch left open
  on purpose is a success; that pair classifies failures a person can
  act on. What splits instead is the WORDING of the one branch-still-on-
  origin set above: `prOpen` in `dashboard/src/serve.ts` is the subset
  that is open deliberately, and `PR_OPEN` in
  `dashboard/src/render/archive-page.ts` is what such a row says instead
  of `NOT_LANDED`. The set itself is unchanged, so the row stays on the
  list and `archive` stays enqueueable for it exactly as before.
  `assessProjectReadiness` is deliberately untouched: every value of
  `codeLanding` is valid to run with, so it is never a reason to refuse
  a run.

**That way out did not work until spec 202.** The dashboard's half was
real — `resolveProject` admitted the job — but `core/scripts/aide-run-spec`
resolved `--spec` against the active folder only, so a re-run refused
with `unknown spec: ... (not under $specs_root)` the moment `archive`'s
own Step 5 had already `git mv`'d the folder into `archive/`. The fix is
a fourth instance of the "try the active folder, then try `archive/`"
pattern already used by `aide_resolve_spec`, `resolve_dependency_folder`
and `status_file_for` (all in `core/scripts/_aide-spec-lib.sh` and
`core/scripts/aide-run-spec`) — gated on `command_name = archive` and on
the candidate's branch still being on origin, via the same `git
ls-remote --heads origin` primitive `dependency_branch_unmerged_on_origin`
already uses. Not found → falls through to the same, unmodified "unknown
spec" refusal, so a genuinely finished spec still refuses a further
`archive` exactly as before.

**A merge that fails is the merging step's problem, not a phase of its
own (spec 171).** There was a sixth step, `resolve`, that a conflicted
row offered a button for; it is gone from `WORKFLOW_STEPS`,
`DEPENDENCY_GATED_STEPS`, the row's controls and the skills. `archive`
does the work instead: `update_branch_to_base()` in
`core/scripts/aide-run-spec` hands `archive` — and only `archive` — the
worktree with the merge OPEN (MERGE_HEAD set, the markers in the files)
where every other step aborts and refuses on the spot, and
`core/skills/aide-archive/SKILL.md`'s Step 1 follows
`references/resolve-conflict.md` before it does anything else. **The
condition is the literal string `archive`, never a denylist of the
others** — a step this got backwards would carry conflict markers into a
commit, which is worse than the refusal it replaced. The gate that makes
a machine resolving a conflict unattended defensible is the project's
own test command: a resolution that does not pass it puts the branch
back where it was found, and nothing lands.

**Review is part of analyze, not a phase of its own (spec 181).**
`review-plan` used to be a standalone workflow step
(`core/skills/aide-review-plan/SKILL.md`) that ran the
three-reviewer-perspective routine — feasibility, scope guardian,
coherence — against `3-solution.md`. It is gone as a step; the routine
now runs inline inside `core/skills/aide-analyze/SKILL.md`, between
writing `3-solution.md` and writing `4-status.md`. The reviewer
subagents are still separate Agent invocations blind to the analyst's
own reasoning — that property doesn't depend on which skill file
triggers the review. `WORKFLOW_STEPS` (the bash string in
`core/scripts/aide-run-spec`, the TypeScript array in
`dashboard/src/queue.ts`) lost `review-plan`, and so did the
workflow arc it feeds — `WORKFLOW_ARC` in `core/scripts/aide-run-spec`,
`HISTORY_STEPS` in `dashboard/src/workflow-history.ts`, `WORKFLOW_STEPS`
in `dashboard/src/parse-status.ts` — all three trimmed from five stages
to four: `create`, `analyze`, `implement`, `archive`.

**`archive` is therefore the one step that can touch the worktree and
fail to finish — the generic commit loop needed a guard for that.**
Every other step either succeeds or refuses before touching the tree.
`archive` is handed an open merge and can be interrupted (crash,
cancellation, a budget stop) after the merge opens
but before the skill commits or aborts it. Left alone, the script's
generic `git add -A` + commit loop would stage the conflict markers and
commit them as the resolution. `core/scripts/aide-run-spec` aborts an
unfinished merge before that loop runs, but only when
`command_name` is `archive` — every other step is unaffected. The
"leaves the branch as it found it" contract for a failed resolution
therefore holds structurally (the script's own abort), not only because
the skill behaves well. One consequence to keep in mind: `archive` used
to be a short, cheap step, and a run that meets a conflict is now as big
a piece of work as a resolution ever was.

**A run reaches the project and its specs root, and nothing else.** A
third repository could be named with `--extra-project-dir`, and got the
same treatment as the other roots — branched, committed, pushed (spec
83, after spec 81's implement wrote into a repository nobody had told
the run about, leaving that half uncommitted while the result reported
success). The dashboard offered it as a tick box per project on every
open row, and none of the 200 jobs the queue held had ever used one, so
the box, the `extraProjects` field and the flag went together. What
stays is the half that mattered: a repo the run was not told about is
not touched. A spec that has to change two projects at once needs the
naming built back, deliberately.

**`aide-run-spec` runs from a private copy of itself, and that is
load-bearing:** an `implement` step reinstalls aide, which copies the script
over itself while bash is still reading it by byte offset. The copy's marker
holds its own path and is unset before `claude` starts — an earlier version
exported a bare flag, `claude` inherited it, and the next nested invocation
deleted the installed script.

**`aide-run-spec`'s shebang finds `/bin/bash` on this machine, and that
is bash 3.2 — `mapfile` is bash 4 and is not available.** Spec 125 (the
Codex runner) needed a table-driven translation and reached for
`mapfile` first; it had to become a function that sets an array via
repeated `array+=(...)` instead. Anything added to this script that
wants an array built from multiple lines needs the same workaround.

**Individual uninstallers never remove the shared scripts** — other AI tools
and the cron job depend on them. The same goes for the skills in
`~/.agents/skills/` (read by both Copilot and Codex, installed via
`core/scripts/_install-skills.sh`). Only `uninstall-all.sh` calls
`uninstall_common_bin` and `uninstall_agents_skills` (as its final steps).

**The PATH block in `~/.zshenv` and `~/.bashrc` follows that same contract
(spec 175).** `install_shell_path` in `core/scripts/_install-bin.sh` writes
a marked, idempotent block putting `/opt/homebrew/bin`, `/usr/local/bin`
and `$HOME/.local/bin` on PATH; every installer calls it, and only
`uninstall-all.sh` calls `uninstall_shell_path`. It exists because
`ssh host 'command'` starts a NON-INTERACTIVE shell, which reads neither
`.zprofile`, `.zshrc` nor `.bash_profile` — `tmux`, `claude` and
`tailscale` were each "command not found" over ssh on the serving host
while a person sitting at the machine found them. Two things not to
change without knowing why: the block carries STABLE directories only (a
versioned path such as mise's bun install dir rots at the next upgrade,
which is why the deploy scripts name such tools by full path), and it is
PREPENDED to `~/.bashrc` while appended to `~/.zshenv` — most `.bashrc`
templates open with a non-interactive early return, so a block after it
would never run for the exact case this fixes.

## Adding new functionality

### New skill

1. Read `docs/SKILL_GUIDE.md` for structure and best practices
2. Create `core/skills/<name>/SKILL.md` with frontmatter and core instructions
3. Put heavy documentation in `core/skills/<name>/references/`
4. Add it to the SKILLS list in uninstall.sh
5. Run `cd implementations/claude-code && ./install.sh`

### Updating rules

1. Edit in `core/rules/` (shared source for all AI tools)
2. Run `core/scripts/build-agents-md.sh` (regenerates `core/AGENTS.md`
   AND `core/skills/spec-structure/SKILL.md`)
3. Run `implementations/claude-code/install.sh` (rules → `~/.claude/rules/`), `implementations/copilot/install.sh` and `implementations/codex/install.sh` (new AGENTS.md → `~/.copilot/` and `~/.codex/`)

**Four of the nine rules are no longer rules (spec 147).** `workflows`,
`documentation`, `tools-and-scripts` and `markdown-linting` are skills in
`core/skills/` now, and `spec-structure` is a rule for Claude Code and a
GENERATED skill for Codex/Copilot. The reason is a byte budget: Codex
appends at most `project_doc_max_bytes` of AGENTS.md — 32768 by default —
and drops the rest silently. At 64399 bytes the file was cut mid-testing.md
and half of it never reached Codex at all, for a month, with nothing to
say so. `test_core_scripts.py::TestBuildAgentsMd::test_output_fits_codex_read_window`
is what says so now. A new rule in `core/rules/` spends that budget; a
new skill in `core/skills/` does not.

Two consequences worth knowing before editing anything here:

- `core/skills/spec-structure/SKILL.md` is generated. Edit
  `core/rules/spec-structure.md` and re-run the build script — never the
  skill directly; `test_core_scripts.py::TestSpecStructureSkillIsGenerated`
  compares the two bodies byte for byte.
- `implementations/claude-code/install.sh` excludes `spec-structure/`
  from its skill rsync by name, so it reaches Codex/Copilot only. That
  exclusion is why `test_core_skills.py::TestUninstallListsEverySkill`
  carries a one-name exception, and it is the third hand-paired list in
  this repo after `WORKFLOW_STEPS` and `DEPENDENCY_GATED_STEPS`.

### Changing the spec structure

The 4-file layout is written down in more places than you would guess.
Spec 82 found them the hard way: fixing the templates alone left
`/aide-analyze` instructing the model to put complexity and risk in
`2-analysis.md`, so the next run rebuilt the bug.

1. `core/rules/spec-structure.md` — the rule itself
2. `core/templates/todo/*.template` — what a new spec starts from
3. `core/skills/aide-create/references/file-templates.md`
4. `core/skills/aide-analyze/SKILL.md` and
   `core/skills/task-workflow-assistant/SKILL.md` — the instructions
   that decide where an AI actually writes what
5. `core/skills/spec-structure/SKILL.md` — generated from item 1 by
   `core/scripts/build-agents-md.sh`; the spec layout left `core/AGENTS.md`
   in spec 147, so this file is where Codex and Copilot read it now
6. `tests/specs/unit/core/validation/test_templates.py` plus the three
   e2e files, which assert the layout

`test_templates.py` enforces items 1-4, so a partial change fails the
suite rather than escaping quietly. Change all six, regenerate,
reinstall.

### install.sh and uninstall.sh

These MUST always mirror each other. When changing one, update the other.

Shared scripts (`core/scripts/` → `~/.local/bin/`) are handled by
`core/scripts/_install-bin.sh` — change the script list *there*, not in each installer.
`install-all.sh` / `uninstall-all.sh` (repo root) run all three in sequence.
