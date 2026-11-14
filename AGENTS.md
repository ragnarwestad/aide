# AGENTS.md - Aide

Aide is a configuration and tooling repo for AI-assisted development.
It is NOT an application in itself.

This file is the rules for working on this repo, read by every AI tool
(`CLAUDE.md` imports it). It is not `core/AGENTS.md`, which is generated
and installed into other projects.

**Rules for one part of the code live in their own files.** Claude Code
loads each one when a file it names is read; any other tool reads the one
for the code it changes before changing it:

- `.claude/rules/writing-docs.md` — the development documentation: the
  READMEs, `docs/`, `dashboard/docs/` and these rule files.
- `dashboard/AGENTS.md` — everything under `dashboard/`, and the runner,
  `core/scripts/aide-run-spec`, which it drives.

---

## Important: Two roles — keep them apart

**Role 1 — Development environment:** This repo is worked on with Claude
Code, and the board's steps on it run on Claude Code or Codex. The Claude
Code config for this repo lives in `.claude/`.

**Role 2 — Product:** `core/implementations/` contains source code we build
and install into other projects. There are implementations
for Claude Code, Codex, OpenCode and Copilot.

**Implementation priority:**
1. **Claude Code** — most important
2. **Codex** — second
3. **OpenCode** — third. It brings no model of its own: every model is a
   provider's, named `provider/model`, and none is reachable until a
   provider is logged in. Its implementation is thin because it scans
   `~/.agents/skills` and `~/.claude/skills` for skills itself.
4. **Copilot** — fourth.

---

## Commands

Two toolchains, and each has its own gate. Neither is guessed: `core/`
is pytest, run from the repo root, and `dashboard/` is bun + TypeScript (see
"Two toolchains, deliberately separate" below).

```bash
.venv/bin/pytest                    # core's gate, run from the root — the scripts,
                                    # the templates, the rules, the skills, the installers
cd dashboard && make test           # the dashboard's gate: tsc --noEmit, then bun test
cd dashboard && bun test test/queue/schedule-store.test.ts   # one suite
npx markdownlint-cli2 '**/*.md'     # markdown, from the repo ROOT (the config lives there)
scripts/check-bash                  # shellcheck over every bash script git tracks — run it when a bash script changed
scripts/check-agents                # agnix over skills, rules, CLAUDE.md, agents and hooks — run it when one of those changed
scripts/check-docs                  # the tests that read the documentation, about ten seconds — run it when a page changed
```

**`bun test` transpiles; it does not type-check.** A green `bun test` says
nothing about types, and `make test` exists to stop that being mistaken for
a green build — it runs `bunx tsc --noEmit` first and fails there. Report
the dashboard as green only once `make test` is, since `bun test` alone
says nothing about types.

`scripts/check-bash` needs shellcheck (`brew install shellcheck`); CI (on a
pull request only) runs the same script, so a bash change that passes it
locally passes there.

Both full runs take minutes, not seconds, and grow with the suites. Run
the full suite ONCE, before the commit, in the background; while working,
run only the narrow files that cover the change (`bun test <file>`, or for
`core/` alone `.venv/bin/pytest core/tests/specs/unit/core/validation`, which
covers the rules, the templates and the skills in seconds).

The dashboard on the serving host runs as a launchd job
(`com.aide-dashboard.serve`), and code reaching `main` changes nothing
there until it is installed: that is what `dashboard/deploy/install-after-merge.sh`
does (`AIDE_INSTALL_CMD`), and Deploy on the board runs it, then restarts. An
`archive` landing in Aide installs nothing, so the runner and the served page
change together. Restart it through launchd (`launchctl kickstart -k`), since a
process started by hand with `pkill` + `bun run` is not the service.

---

## Reading the documentation

**Grep the long pages; do not read one whole.** `docs/AI_NEWS_LOG.md` runs to several hundred lines and
the dashboard's docs pages to 550; they are written to be searched. Where to look:

| Question                                                  | Page                                          | Who it's for      |
|-----------------------------------------------------------|-----------------------------------------------|-------------------|
| What the dashboard is, its URLs, live runs                | `dashboard/README.md`                         | Both              |
| How the queue runs specs, and what it tells you           | `dashboard/docs/running-specs.md`             | Both              |
| What a run does to the repositories and its checkouts     | `dashboard/docs/the-runner.md`                | Changing the code |
| What a row on the specs list says, the spec page          | `dashboard/docs/the-specs-list.md`            | Changing the code |
| How dashboard pages change in place                       | `dashboard/docs/page-changes.md`              | Changing the code |
| Adding a project, whether a run can start there           | `dashboard/docs/projects.md`                  | Both              |
| A job's states and every transition between them          | `dashboard/docs/job-states.md`                | Changing the code |
| Writing a spec, the four phases, what stops one           | `dashboard/docs/spec-lifecycle.md`            | Using the board   |
| How each move between phases is decided and recorded      | `dashboard/docs/spec-transitions.md`          | Changing the code |
| How a step's branch is merged, conflicts, unlanded work   | `dashboard/docs/landing.md`                   | Changing the code |
| The one rule every error the board shows follows          | `dashboard/docs/error-sentences.md`           | Changing the code |
| Tokens, components and the CSS class vocabulary           | `dashboard/docs/design-system.md`             | Changing the code |
| Every HTTP route: method, read or action, what it takes   | `dashboard/docs/http-routes.md`               | Changing the code |
| The decisions made twice, in bash and TypeScript          | `dashboard/docs/bash-typescript-decisions.md` | Changing the code |
| The dashboard's own tests, and running it from a checkout | `dashboard/docs/developing.md`                | Changing the code |
| Serving it, HTTPS, moving it to another host              | `dashboard/docs/hosting.md`                   | Running the board |
| Reaching the board from a phone or another computer       | `dashboard/docs/tailscale.md`                 | Running the board |
| The test server a held-back spec offers                   | `dashboard/docs/test-server.md`               | Using the board   |
| When the tests run in a spec, and what red means          | `dashboard/docs/tests-in-a-spec.md`           | Both              |
| Installation layout, what goes where, the gotchas         | This file, "What gets installed where"        | Changing the code |
| What a word means: phase, step, landing, round, held back | `docs/GLOSSARY.md`                            | Both              |
| Ideas being considered for Aide, and where they stand     | `docs/ROADMAP.md`                             | Both              |
| How Aide uses agents, subagents and loops in each step    | `docs/AGENTS_AND_LOOPS.md`                    | Both              |
| How Aide compares with spec tools and agent runners       | `docs/COMPARISON.md`                          | Both              |
| Replaying archived specs to choose a step's model         | `docs/REPLAY.md`                              | Changing the code |
| Sources on writing specs for AI agents, to be analysed    | `docs/SPEC_WRITING_SOURCES.md`                | Changing the code |
| Every key in `.aide/config` and `.aide/project.yaml`      | `docs/CONFIGURATION.md`                       | Both              |
| What each AI tool supports, verified                      | `docs/AI_SUPPORT_MATRIX.md`                   | Changing the code |
| How to write a skill                                      | `docs/SKILL_GUIDE.md`                         | Changing the code |
| Installing Aide on a machine, checking the install        | `docs/INSTALLATION.md`                        | Both              |
| What changed in the AI tools Aide installs for            | `docs/AI_NEWS_LOG.md`                         | Both              |

---

## Important rules

**A `git push` waits while an archive lands on the board.** A hook in
`.claude/settings.json` (and `dashboard/.claude/settings.json`) runs
`scripts/guard-push` before every Bash call, and blocks a push to a repo
while the board lands a project whose code or specs repo has the same
origin, or when the queue or those origins cannot be read. A landing in
another project does not block it. Off the
machine that serves the board it reads the queue over ssh from
`AIDE_BOARD_HOST`, set under `"env"` in that folder's
`.claude/settings.local.json`.

**The workflow steps are skills (slash commands), not CLI scripts.**
`/aide-create`, `/aide-analyze`, `/aide-implement` etc. run inside the AI tool.
`core/scripts/` holds the helper scripts (`aide-*`) those skills and the runner call.

The sections below hold the installation overview, the layout gotchas and
how to add new functionality. The `/ai-tools-reference` skill holds
the verified config reference for Claude Code, Codex and Copilot (not OpenCode); `/ai-tools-upgrade` holds the
daily-upgrade setup for a machine.

See `docs/ROADMAP.md` for the ideas being considered for Aide, and
"Decisions that shape the repo" below for the decisions that shape it.

---

## Repo layout

**Two parts side by side: `core/` is the method, `dashboard/` the board.**
`core/` holds the skills, rules, templates and scripts, the installers in
`core/implementations/` and their pytest suite in `core/tests/`; it works
without the dashboard. `dashboard/` uses `core/`, never the other way
round. The runner, `core/scripts/aide-run-spec`, is the board's engine but
stays in `core/scripts/` with the scripts it calls, since it is installed
beside them in `~/.local/bin/`.

**`dashboard/` came in with `git subtree add`, and its history is only
reachable through `git blame`.** `git log --follow -- dashboard/<file>`
and plain `git log -- dashboard/<file>` stop at the import commit and
show nothing older — that is how subtree boundaries work, not a sign the
move went wrong. `git blame dashboard/src/discover.ts` does attribute
every line to its original pre-merge commit and author. The
standalone `aide-dashboard` repo is kept as a fallback but no longer
carries a manifest, so it is not a project in its own right anymore.

**Two toolchains, deliberately separate.** `core/` is pytest, run from
the repo root (`pytest.ini`, no lockfile); `dashboard/` is bun + TypeScript
(`dashboard/bun.lock`). Aide's test command is its `AIDE_TEST_CMD`, which
runs both suites and the browser tests. Lint/build detection reads the
ROOT only — a `package.json` at the root would silently redirect it, which
`core/tests/specs/unit/core/validation/dashboard/test_dashboard_merge.py` guards
against. Run the dashboard's own suite from inside `dashboard/` with `make test`:
it type-checks first, then spreads the test files over one bun process per
core (`dashboard/scripts/run-tests.sh`). A bare `bun test` runs them in one
process and takes several times as long.

**The queue/worktree/merge/archive internals live under `dashboard/`,**
not here — that content only matters to a session actually working in
`dashboard/`. `dashboard/AGENTS.md` holds what every such session needs,
and `dashboard/.claude/rules/` holds the rules for one part of the code
(the landing, archive and close; signalling a process group; the design
rules). Both also document `core/scripts/aide-run-spec`, so a change to
the runner reads them too.

**`specs/` is gitignored, and `specs/README.md` alone is force-tracked.**
A project's specs are its own, not this repo's; `AIDE_SPECS_PATH` points
Aide's own at `aide-specs/aide/`.

**`scripts/generate-toc.py` and `scripts/normalize-specs.py` write
"Table of contents" and recognise "Innholdsfortegnelse" as well**, so a
spec written before the repo was translated still has its heading found.

## What gets installed where

Everything is installed **globally** — not per project. `./install-all.sh`
(repo root) reads `core/scripts/lib/ai-tools/tools.txt` and runs the matching
`core/implementations/<ai>/install.sh`. Each installer calls the common steps
in `core/scripts/_install-steps.sh`, then runs its own AI-specific setup.
The list also drives preflight, version stamping and upgrades. `aide-emit-run`
and `aide-run-spec` are opt-in and inert until something invokes them.

- **Individual uninstallers never remove the shared scripts**, nor the
  skills in `~/.agents/skills/` — other tools and the cron job depend on
  them. Skill manifests record exactly what each install wrote; uninstall
  removes only those names. Only `uninstall-all.sh` removes the shared scripts
  and the skills under `~/.agents/skills/`.
- **The PATH block in `~/.zshenv` and `~/.bashrc`** (`install_shell_path`
  in `core/scripts/_install-bin.sh`) follows the same contract, and exists
  because `ssh host 'command'` is a non-interactive shell that reads
  neither `.zprofile`, `.zshrc` nor `.bash_profile`. It carries STABLE
  directories only, and is PREPENDED to `~/.bashrc` — most templates
  return early for a non-interactive shell — while appended to `~/.zshenv`.

## Decisions that shape the repo

- **`core/` is the product.** Skills, rules, scripts and templates live
  there once; `core/implementations/` holds only thin install scripts. No
  per-tool adapters: hand-maintained adapters were the main maintenance
  cost, which is why Gemini and the per-tool extras were dropped.
- **Four tools through shared standards.** Claude Code reads the skills in
  `~/.claude/skills/`; Copilot and Codex read them in `~/.agents/skills/`,
  and OpenCode scans both. Copilot, Codex and OpenCode read the generated
  `core/AGENTS.md`, installed as `~/.copilot/copilot-instructions.md`,
  `~/.codex/AGENTS.md` and `~/.config/opencode/AGENTS.md`.
- **`core/AGENTS.md` is generated** by `core/scripts/build-agents-md.sh`
  from `core/agents-intro.md` and `core/rules/`; never edit it by hand.
- **Skill frontmatter is additive only.** Beyond the Agent Skills spec's
  fields, only Claude Code extras whose absence costs a nicety (`effort`,
  `argument-hint`), enforced by an allowlist test. A field that changes
  behaviour in one tool and is ignored by the others is not allowed.
- **claude-usage is consumed, never modified.** `~/develop/claude-usage` is
  a clean clone of someone else's tool; the dashboard keeps its own
  receivers rather than patching it, and makes no request to its HTTP API.
- **The original customer workspace is reference only.** A frozen copy
  exists locally; nothing is developed there.

## Code health

Divide and conquer, everywhere: a file does one thing and stays short, a
folder holds a handful of files about one subject, and a part that grows
becomes a folder of its own. These rules hold for the whole repository —
TypeScript, bash, Python and CSS alike; Markdown is left out of the limits,
since a page is as long as what it says.

1. **A source file stays at or under 500 lines, a test file at or under
   800.**
2. **A folder holds at most 15 source or test files directly inside it.**
   One that would go past 15 is split into subfolders named for what their
   files are about — `test/e2e/specs-list/`, `test/serve/schedule/`.
3. **A module split across several files is a folder named after the
   module** — never a file sitting beside a folder of the same name.
4. **A test lives under the path that matches what it tests**: the test
   for `dashboard/src/queue/store/index.ts` under `dashboard/test/queue/`,
   the tests for `core/scripts/lib/run-spec/` under
   `core/tests/specs/unit/core/scripts/run_spec/`. A small, tightly-coupled file
   may keep its test beside it, as the dashboard's message catalogues do.
5. **Where a language or framework has an established pattern, it is
   followed, and it wins over the rules above where they meet:**
   - TypeScript: a module in several files is a folder with an `index.ts`
     that says what it exports.
   - Python and pytest: packages carry `__init__.py`, test files are named
     `test_*.py`, shared fixtures live in `conftest.py`, and folder names
     use underscores (`run_spec`, not `run-spec`).
   - Bash and Unix: the commands a user runs sit flat in one folder that is
     installed onto PATH, and what they source sits in `lib/`. That is why
     `core/scripts/` holds every `aide-*` command in one folder, past 15.
   - CSS: the stylesheets load in a fixed order, and the order is part of
     what they mean; a split keeps it (`dashboard/src/render/ui/css/index.ts`).

A file or folder already over its limit is held at what it has until it is
split, so it can only shrink, and a new one cannot cross the limit. A part
nearing a limit is split by responsibility, not by size: pull out the part
that has its own name, not an arbitrary half.

- `core/tests/specs/unit/core/validation/test_code_health.py` checks everything
  outside `dashboard/`, with what it holds in `OVER_LINE_LIMIT` and
  `OVER_FOLDER_LIMIT`.
- `dashboard/test/design/code-health-limits.test.ts` checks `dashboard/`,
  with its own held files and the message catalogues it exempts by name.
  `dashboard/AGENTS.md`, "Code health", has what is particular to the
  dashboard.

## Adding new functionality

Adding a skill, updating a shared rule, or changing the spec structure
is covered by the `aide-repo-maintenance` skill — invoke it when you
need it.
