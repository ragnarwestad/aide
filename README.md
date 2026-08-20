# aide

A structured workspace for AI-assisted development. Supports Claude Code, GitHub Copilot and Codex.

## Table of contents

- [Vision](#vision)
- [For end users](#for-end-users)
- [For aide developers](#for-aide-developers)
- [Environment variables](#environment-variables)
  - [AIDE_INSTALLATION_PATH](#aide_installation_path-required-for-dist-packages)
  - [AIDE_PROJECTS_PATH](#aide_projects_path-optional)
  - [AIDE_SPECS_PATH](#aide_specs_path-optional-per-project)
- [AI-assisted workflow](#ai-assisted-workflow)
- [Running a workflow step headless (opt-in)](#running-a-workflow-step-headless-opt-in)
- [Keeping a serving host's specs current (opt-in)](#keeping-a-serving-hosts-specs-current-opt-in)
- [Resources](#resources)

---

## Vision

This workspace enables a workflow where **any AI assistant** can:

- Understand complex JIRA issues and analyze the codebase automatically
- Suggest concrete solutions with file references and line numbers
- Implement changes using Test-Driven Development (TDD)
- Follow established plans for technical debt and modernization

**Key benefit:** Not locked to a single AI vendor - teams can pick the best tool for each task.

---

## For end users

> **You do not need to clone this repo to use aide.**

Download the ready-made package for your AI tool:

| AI tool        | Package                     | Documentation                                        |
|----------------|-----------------------------|------------------------------------------------------|
| Claude Code    | `dist/aide-claude-code.zip` | [INSTALL.md](implementations/claude-code/INSTALL.md) |
| GitHub Copilot | `dist/aide-copilot.zip`     | [INSTALL.md](implementations/copilot/INSTALL.md)     |
| Codex          | `dist/aide-codex.zip`       | [README.md](implementations/codex/README.md)         |

Each package contains everything you need: instructions, commands/prompts, scripts and documentation.

> **Windows users:** The scripts require WSL or Git Bash. See [WSL installation](https://learn.microsoft.com/en-us/windows/wsl/install).

---

## For aide developers

Want to **contribute to or further develop** aide?

👉 **[DEVELOPING.md](DEVELOPING.md)** - Complete developer guide

Contains:
- Getting started (clone, install, test, build)
- Detailed directory structure
- Testing
- How to add new functionality

The workspace is designed to handle **cross-cutting issues** where a single JIRA issue can affect multiple projects at once.

---

## Environment variables

### AIDE_INSTALLATION_PATH (required for dist packages)

Path to where aide is installed.

```bash
export AIDE_INSTALLATION_PATH="/Users/$(whoami)/develop/aide"
```

### AIDE_PROJECTS_PATH (optional)

Solves permission issues when AI tools expand relative paths.

```bash
export AIDE_PROJECTS_PATH="/Users/$(whoami)/develop"
```

### AIDE_SPECS_PATH (optional, per project)

Store specs (JIRA analyses, TODO plans) outside a project — set the key
in `.aide/config` in that project's root:

```text
AIDE_SPECS_PATH=/Users/you/develop/my-specs-repo
```

**Default:** specs are written to `specs/` in the project root. The path
is per-project configuration, not an environment variable — two projects
can point at two different spec repos. Keep the personal config out of git
with a global personal gitignore (`core.excludesFile`) containing
`.aide/config` — the manifest `.aide/project.yaml` is team knowledge
and belongs in git.

---

## AI-assisted workflow

All AI tools follow the same basic workflow:

```text
1. CREATE document structure
   ↓
   Fetches JIRA issue → Creates 4 files (description/analysis/solution/status)

2. ANALYZE codebase
   ↓
   Searches the codebase → Identifies affected files → Updates documentation

3. SOLVE the problem
   ↓
   RED: Write tests → GREEN: Implement → REFACTOR: Verify

4. VERIFY
   ↓
   Run tests → Linting → Build → Commit
```

**Example (Claude Code):**

```bash
/aide-create PROJ-7890    # Create document structure
/aide-analyze PROJ-7890   # Analyze codebase
/aide-implement PROJ-7890        # Implement with TDD
```

**See:** [core/rules/workflows.md](core/rules/workflows.md) for details.

---

## Running a workflow step headless (opt-in)

`aide-run-spec` runs ONE workflow step for ONE spec without a human in
the chair — the guards are the point, not the invocation:

```bash
aide-run-spec --project-dir ~/develop/myproject --command analyze --spec 81 \
              --budget-usd 3 --timeout-sec 1200 \
              --permission-mode acceptEdits \
              --result-file /tmp/step.json [--push none|branch|pr] [--pull]
              [--worktree-base ~/aide-worktrees]
```

It refuses to start when the spec folder does not exist or when a
required value is missing — but not over a dirty checkout: the work
happens in a worktree cut from origin's default branch, so what somebody
left uncommitted in the main checkout is their business and stops
nobody. `--permission-mode` is never defaulted, because the most dangerous knob has to be typed out
by whoever starts the run. It enforces its own wall clock (SIGTERM to
the process group, then SIGKILL), commits whatever the step managed to
write in BOTH roots — the project and the specs repo — and writes one
JSON line to stdout and to `--result-file`.

**Every run works in `git worktree` checkouts of its own**, one per repo
it touches, under `$HOME/aide-worktrees/<project>/<spec>/`
(`--worktree-base` relocates them; a base inside any of the repos is
refused). The real checkouts are only ever put back **onto** their
default branch and fast-forwarded — never switched to a spec branch — so
two runs can go at once without deciding what the other is compiling,
and a person can use the checkout while a job runs. The worktrees go
when the run ends, and one left behind by a killed run is swept by the
next run for that spec.

A worktree carries tracked files only, so anything gitignored that the
step needs has to be named in the project's `.aide/config`:

```text
AIDE_WORKTREE_LINKS=.venv dashboard/node_modules
```

Those paths are symlinked in from the main checkout and kept out of the
commit. Without them, a test command living behind one of them fails for
a reason that has nothing to do with the change.

**Installing aide gives nobody a queue.** The script does nothing until
it is invoked, and it is what a scheduler drives (the aide-dashboard
queue does exactly that). `--dry-run` prints the command line it would
use and starts nothing.

`aide-emit-run` is the same kind of opt-in: inert unless `AIDE_RUN_URL`
is set. Besides the `UserPromptSubmit` hook it has a phase mode
(`aide-emit-run --phase red|green|refactor --spec N`) that the
`/aide-implement` skill calls at each TDD boundary, so a headless run
can be followed while it works.

---

## Keeping a serving host's specs current (opt-in)

A dashboard lists specs by reading the spec folders off the serving
host's working copy, and nothing pulls that copy. A spec written and
pushed from another machine is simply not there — and a spec that is not
listed cannot be queued.

`aide-pull-specs` is the unattended pull for exactly that case:

```bash
aide-pull-specs ~/develop/aide-specs [~/develop/other-specs ...]
```

Each repo is pulled only when it is safe to do so with nobody watching:
a git working tree, nothing uncommitted, sitting on its own default
branch, and a fast-forward. Anything else is skipped with a reason, and
the repos beside it are still pulled. Nothing is ever committed, merged
or reset. A repo already up to date prints nothing, so a cron entry
mails only when something happened.

On an always-on host, every two minutes:

```cron
*/2 * * * * $HOME/.local/bin/aide-pull-specs $HOME/develop/aide-specs
```

**Point it at specs, not at code.** Merging code and installing it
belong together (`AIDE_INSTALL_CMD`), and a background pull would move
the code under a server that goes on running the old version — merged,
but not deployed, and reported as deployed.

Code that landed some other way is REPORTED instead of pulled. The
dashboard's own Merge button runs `AIDE_INSTALL_CMD` and says what
happened; a merge made from a laptop, the GitHub web UI or another
machine runs nothing at all. For every project that has an install
command configured, `/projects` compares the checkout against
`origin` on each load and says "N commits behind origin — deploy is a
hand step" on that project's row. It only ever looks: nothing on that
page fetches more than the default branch, and nothing merges, pulls or
moves a checkout.

---

## Resources

- [DEVELOPING.md](DEVELOPING.md) - Developer guide for aide
- [core/rules/workflows.md](core/rules/workflows.md) - JIRA/TODO workflows
- [core/rules/git.md](core/rules/git.md) - Git rules
