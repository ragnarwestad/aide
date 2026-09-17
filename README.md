# <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/aide-wordmark-dark.svg"><img src="docs/assets/aide-wordmark-light.svg" alt="Aide" height="40"></picture>

## Table of contents

- [What it is](#what-it-is)
- [The aide-* skills](#the-aide--skills)
- [Install](#install)
- [AI-assisted workflow](#ai-assisted-workflow)
- [The Aide dashboard](#the-aide-dashboard)
- [Per-project configuration](#per-project-configuration)
    - [AIDE_SPECS_PATH](#aide_specs_path-optional-per-project)
- [Resources](#resources)

---

## What it is

An AI assistant is powerful but unpredictable when the requirements for a change live only in a chat history: the
reasoning behind a decision disappears with the conversation, the next session starts from zero, and nobody else can
review what was actually agreed before the code was written.

Aide's answer is spec-driven development (SDD): before any AI assistant writes code, it writes a specification — four
plain-Markdown files (description, analysis, solution, status) that a person and any AI tool can read, review and
continue identically, committed to git alongside the code it describes.

**The dashboard is the usual way in.** It lists every spec across every project Aide knows about, and runs each one
through create, analyze, implement and archive for you — queued and unattended, with a person stepping in only where
a judgement is needed, such as ticking the acceptance criteria before archive.
See [The Aide dashboard](#the-aide-dashboard).

**The skills are what it runs.** Each step is an `aide-*` skill, and the same skills work by hand, one spec at a
time, inside Claude Code, Codex, OpenCode or GitHub Copilot. See [The aide-\* skills](#the-aide--skills).

Either way, the spec is what lets any AI assistant:

- Understand a spec and analyze the codebase automatically
- Suggest concrete solutions with file references and line numbers,
  reviewable as a diff before a line of code changes
- Implement changes using Test-Driven Development (TDD)
- Follow established plans for technical debt and modernization that
  span many sessions, not one prompt

**Key benefit:** Not locked to a single AI vendor - teams can pick the
best tool for each task, and the spec is what carries the work between
them.

---

## The aide-\* skills

The four spec-workflow skills, in the order a spec moves through them:

| Skill             | Does                                                                                                                                           |
|-------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| `/aide-create`    | Creates a spec from a title and a description: the 4-file structure (description, analysis, solution, status)                                  |
| `/aide-analyze`   | Analyzes the codebase, detects LOW/MEDIUM/HIGH complexity, maps affected files with file:line references, and writes the TDD plan              |
| `/aide-implement` | Implements the plan with TDD (RED → GREEN → REFACTOR), reading the existing analysis and solution                                              |
| `/aide-archive`   | Archives a finished spec, resolves any merge conflict with the default branch, and feeds durable knowledge back into the project's living docs |

Supporting skills, used around that workflow rather than as a step in it:

| Skill            | Does                                                                                                                    |
|------------------|-------------------------------------------------------------------------------------------------------------------------|
| `/aide-explore`  | A no-stakes thinking partner before `/aide-create` — weighs approaches and sharpens the scope, creates nothing          |
| `/aide-manifest` | Drafts or refreshes a project's `.aide/project.yaml` manifest (stack, dependencies, deployment, docs)                   |
| `/aide-close`    | Closes a spec whose idea did not hold: records the reason, moves it to `archive/`, and deletes its code branch unmerged |
| `/aide-reopen`   | Takes an archived spec back into the active list for another round, keeping the description and archive trail           |
| `/aide-reset`    | Resets an invalid active spec work round, keeping its README, description, commits and job history                      |
| `/aide-to-pdf`   | Generates a PDF from a spec's documentation                                                                             |

---

## Install

Clone the repo, then run the installer for your AI tool:

| AI tool        | Install                                  | Documentation                                        |
|----------------|------------------------------------------|------------------------------------------------------|
| Claude Code    | `implementations/claude-code/install.sh` | [INSTALL.md](implementations/claude-code/INSTALL.md) |
| GitHub Copilot | `implementations/copilot/install.sh`     | [INSTALL.md](implementations/copilot/INSTALL.md)     |
| Codex          | `implementations/codex/install.sh`       | [README.md](implementations/codex/README.md)         |
| OpenCode       | `implementations/opencode/install.sh`    | [README.md](implementations/opencode/README.md)      |

`./install-all.sh` runs all four at once. Each installer is self-contained: instructions, commands/prompts, scripts and
documentation, installed globally so any project can use them.

The dashboard is installed after this, on the machine that will run it: it starts every step through Aide's own
scripts and skills, so they have to be there first. See
[Installation in the dashboard's README](dashboard/README.md#installation).

> **Windows users:** The scripts require WSL or Git Bash.
> See [WSL installation](https://learn.microsoft.com/en-us/windows/wsl/install).

---

## AI-assisted workflow

All AI tools follow the same basic workflow:

```text
   (EXPLORE — optional: think the idea through first, no files yet)

1. CREATE the spec
   ↓
   A title and a description → 4 files (description/analysis/solution/status)

2. ANALYZE the codebase
   ↓
   Reads the code → Identifies affected files → Writes the plan, and reviews it

3. IMPLEMENT the solution
   ↓
   RED: Write tests → GREEN: Implement → REFACTOR — the phase ends on a green test run

4. ARCHIVE
   ↓
   Lands the code on the default branch → Feeds what was learned back into the docs
```

**Example (Claude Code):**

```bash
/aide-create "Move the forms off Redux Form" The forms still use Redux Form, which is unmaintained. Move them to React Hook Form, one form at a time, keeping the validation rules.
# The spec gets a number, say 55:
/aide-analyze 55      # Analyze the codebase
/aide-implement 55    # Implement with TDD
/aide-archive 55      # Archive, feed knowledge back into the docs
```

**See:** [core/skills/workflows/SKILL.md](core/skills/workflows/SKILL.md) for details.

---

## The Aide dashboard

The skills above are run by hand, one spec at a time, in whichever tool you have open. The dashboard runs them for
you: it lists every spec across every project Aide knows about, grouped by phase, and queues a spec through
`create` → `analyze` → `implement` → `archive` without anyone watching. A running job shows its live progress on the
spec's row, and clicking a spec opens its description, analysis, plan, status and every job that has run against it.

It finds projects by scanning for `.aide/project.yaml` manifests and reads each spec's phase from its `4-status.md`,
so nothing has to be registered by hand. It runs as a small server on a machine of your choosing — a laptop, or a
machine that stays on so runs continue after you close the lid.

It lives in `dashboard/` and has its own documentation: **[dashboard/README.md](dashboard/README.md)**.

---

## Per-project configuration

### AIDE_SPECS_PATH (optional, per project)

Store specs outside a project — set the key
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

## Resources

- [DEVELOPING.md](DEVELOPING.md) - Developer guide for Aide
- [core/skills/workflows/SKILL.md](core/skills/workflows/SKILL.md) - The spec workflow
- [core/rules/git.md](core/rules/git.md) - Git rules
