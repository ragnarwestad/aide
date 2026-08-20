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
  `dashboard/node_modules` reach it through `AIDE_WORKTREE_LINKS` in
  `.aide/config` — symlinked in, and excluded from `git add -A` by
  pathspec, because a `dir/` gitignore rule does not match a symlink.

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
and it works the same way.** `implement`, `resolve` and `archive` are
the steps an unmerged dependency holds back; the other steps run
regardless. The bash string in `core/scripts/aide-run-spec` and the
TypeScript array in `dashboard/src/serve.ts` are pinned to each other by
`test_the_two_copies_of_the_dependency_gate_agree`, and are edited by
hand together exactly as `WORKFLOW_STEPS` is. The dashboard's copy is
what decides whether a queued job is PARKED (left `queued` with the
reason on its row until the dependency merges); the script's copy is
what decides whether a run started by hand is REFUSED.

**One step, `resolve`, can touch the worktree and fail to finish — the
generic commit loop needed a guard for that.** Every other step either
succeeds or refuses before touching the tree. `resolve` merges origin's
default branch into the spec's branch inside the worktree and can be
interrupted (crash, cancellation, a budget stop) after the merge opens
but before the skill commits or aborts it. Left alone, the script's
generic `git add -A` + commit loop would stage the conflict markers and
commit them as the resolution. `core/scripts/aide-run-spec` now aborts
an unfinished merge before that loop runs, but only when
`command_name` is `resolve` — every other step is unaffected. The
"leaves the branch as it found it" contract for a failed resolution
therefore holds structurally (the script's own abort), not only because
the skill behaves well.

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

## Adding new functionality

### New skill

1. Read `docs/SKILL_GUIDE.md` for structure and best practices
2. Create `core/skills/<name>/SKILL.md` with frontmatter and core instructions
3. Put heavy documentation in `core/skills/<name>/references/`
4. Add it to the SKILLS list in uninstall.sh
5. Run `cd implementations/claude-code && ./install.sh`

### Updating rules

1. Edit in `core/rules/` (shared source for all AI tools)
2. Run `core/scripts/build-agents-md.sh` (regenerates `core/AGENTS.md`)
3. Run `implementations/claude-code/install.sh` (rules → `~/.claude/rules/`), `implementations/copilot/install.sh` and `implementations/codex/install.sh` (new AGENTS.md → `~/.copilot/` and `~/.codex/`)

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
5. `core/AGENTS.md` — generated; run `core/scripts/build-agents-md.sh`
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
