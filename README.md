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

| AI tool | Package | Documentation |
|------------|-------|---------------|
| Claude Code | `dist/aide-claude-code.zip` | [INSTALL.md](implementations/claude-code/INSTALL.md) |
| GitHub Copilot | `dist/aide-copilot.zip` | [INSTALL.md](implementations/copilot/INSTALL.md) |
| Codex | `dist/aide-codex.zip` | [README.md](implementations/codex/README.md) |

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
```

It refuses to start when either git root is dirty, when the spec folder
does not exist, or when a required value is missing; `--permission-mode`
is never defaulted, because the most dangerous knob has to be typed out
by whoever starts the run. It enforces its own wall clock (SIGTERM to
the process group, then SIGKILL), commits whatever the step managed to
write in BOTH roots — the project and the specs repo — and writes one
JSON line to stdout and to `--result-file`.

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

## Resources

- [DEVELOPING.md](DEVELOPING.md) - Developer guide for aide
- [core/rules/workflows.md](core/rules/workflows.md) - JIRA/TODO workflows
- [core/rules/git.md](core/rules/git.md) - Git rules
