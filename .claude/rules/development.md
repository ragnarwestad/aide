# Development in Aide

## Repo layout

**`dashboard/` came in with `git subtree add`, and its history is only
reachable through `git blame`.** `git log --follow -- dashboard/<file>`
and plain `git log -- dashboard/<file>` stop at the import commit and
show nothing older — that is how subtree boundaries work, not a sign the
move went wrong. `git blame dashboard/src/discover.ts` does attribute
every line to its original pre-merge commit and author. The
standalone `aide-dashboard` repo is kept as a fallback but no longer
carries a manifest, so it is not a project in its own right anymore.

**Two toolchains, deliberately separate.** The repo root is pytest
(`pytest.ini`, no lockfile); `dashboard/` is bun + TypeScript
(`dashboard/bun.lock`). Aide's test command is its `AIDE_TEST_CMD`, which
runs both suites and the browser tests. Lint/build detection reads the
ROOT only — a `package.json` at the root would silently redirect it, which
`tests/specs/unit/core/validation/dashboard/test_dashboard_merge.py` guards
against. Run the dashboard's own suite from inside `dashboard/` with `make test`:
it type-checks first, then spreads the test files over one bun process per
core (`dashboard/scripts/run-tests.sh`). A bare `bun test` runs them in one
process and takes several times as long.

**The queue/worktree/merge/archive internals live under `dashboard/`,**
not here — that content only matters to a session actually working in
`dashboard/`. `dashboard/CLAUDE.md` holds what every such session needs,
and `dashboard/.claude/rules/` holds the rules for one part of the code
(the landing, archive and close; signalling a process group; the design
rules), loaded when a file they name is read. Both also document
`core/scripts/aide-run-spec`; a session run from here reads them by hand,
since a rule scoped by `paths:` loads only for a session whose working
directory is `dashboard/`.

**`specs/` is gitignored, and `specs/README.md` alone is force-tracked.**
A project's specs are its own, not this repo's; `AIDE_SPECS_PATH` points
Aide's own at `aide-specs/aide/`.

**`scripts/generate-toc.py` and `scripts/normalize-specs.py` write
"Table of contents" and recognise "Innholdsfortegnelse" as well**, so a
spec written before the repo was translated still has its heading found.

## What gets installed where

Everything is installed **globally** — not per project. `./install-all.sh`
(repo root) runs each `implementations/<ai>/install.sh`. Each installer
starts with `core/scripts/aide-preflight <tool>` (informational only) and
is self-contained: the shared scripts (`core/scripts/` → `~/.local/bin/`,
listed once in `core/scripts/_install-bin.sh` and sourced as
`install_common_bin`) plus its own AI-specific setup. `aide-emit-run` and
`aide-run-spec` are opt-in and inert until something invokes them.

- **Individual uninstallers never remove the shared scripts**, nor the
  skills in `~/.agents/skills/` — other tools and the cron job depend on
  them. Only `uninstall-all.sh` calls `uninstall_common_bin` and
  `uninstall_agents_skills`, as its final steps.
- **The PATH block in `~/.zshenv` and `~/.bashrc`** (`install_shell_path`
  in `core/scripts/_install-bin.sh`) follows the same contract, and exists
  because `ssh host 'command'` is a non-interactive shell that reads
  neither `.zprofile`, `.zshrc` nor `.bash_profile`. It carries STABLE
  directories only, and is PREPENDED to `~/.bashrc` — most templates
  return early for a non-interactive shell — while appended to `~/.zshenv`.

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
   `tests/specs/unit/core/scripts/run_spec/`. A small, tightly-coupled file
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

- `tests/specs/unit/core/validation/test_code_health.py` checks everything
  outside `dashboard/`, with what it holds in `OVER_LINE_LIMIT` and
  `OVER_FOLDER_LIMIT`.
- `dashboard/test/design/code-health-limits.test.ts` checks `dashboard/`,
  with its own held files and the message catalogues it exempts by name.
  `dashboard/CLAUDE.md`, "Code health", has what is particular to the
  dashboard.

## Adding new functionality

Adding a skill, updating a shared rule, or changing the spec structure
is covered by the `aide-repo-maintenance` skill — invoke it when you
need it.
