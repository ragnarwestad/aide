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
each step's branch when the step reports success — `create`, `analyze`
and `review-plan` merge into the repo's default branch and delete the
branch on origin; `implement` lands nothing, so code waits
on its branch until `archive`, which merges every repo the spec's
branch still exists in (specs first, code last), runs `AIDE_INSTALL_CMD`
after a code root, and then archives. There is no Merge or Approve button, no `gateAfter` and
no `awaiting-approval` state; a landing refused for a conflict leaves
the branch and records `errorReason: "conflict"` on the job.
`landBranch` in `dashboard/src/serve.ts` is the one place all of this
happens, under `mergeLock` per repo root.

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

**A repo beyond the project and its specs root has to be NAMED**, with
`--extra-project-dir` (repeatable; the queue's form calls it "Also
touches"). The run only watches, commits and pushes the roots it knows
about: spec 81's own implement step wrote to a third repository nobody
had told it about, and that half was left uncommitted on the machine
while the result reported success. A named repo gets exactly the same
treatment as the others — branched, committed, pushed — and a name that
is already a root is ignored rather than watched twice (spec 83). Since spec 91 the run also **names each
passenger's worktree in the prompt**: a passenger is addressed by
absolute path and nothing else, so a step that was not told would write
into the main checkout and the commit loop would commit nothing.

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
