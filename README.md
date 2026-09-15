# <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/aide-wordmark-dark.svg"><img src="docs/assets/aide-wordmark-light.svg" alt="Aide" height="40"></picture>

A spec-driven development (SDD) workspace for AI-assisted coding. Supports Claude Code and Codex; a GitHub Copilot
implementation is kept but unverified since August 2026, for want of a subscription to test it against.

## Table of contents

- [What it is](#what-it-is)
- [The aide-* skills](#the-aide--skills)
- [For end users](#for-end-users)
- [Per-project configuration](#per-project-configuration)
    - [AIDE_SPECS_PATH](#aide_specs_path-optional-per-project)
- [AI-assisted workflow](#ai-assisted-workflow)
- [The Aide dashboard](#the-aide-dashboard)
- [Resources](#resources)

---

## What it is

An AI assistant is powerful but unpredictable when the requirements for a
change live only in a chat history: the reasoning behind a decision
disappears with the conversation, the next session starts from zero, and
nobody else can review what was actually agreed before the code was
written.

Aide's answer is spec-driven development: before any AI assistant writes
code, it writes a specification — four plain-Markdown files (description, analysis, solution, status) that a person and
any AI tool
can read, review and continue identically, committed to git alongside
the code it describes. That structure is what lets **any AI assistant**:

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

| Skill            | Does                                                                                                           |
|------------------|----------------------------------------------------------------------------------------------------------------|
| `/aide-explore`  | A no-stakes thinking partner before `/aide-create` — weighs approaches and sharpens the scope, creates nothing |
| `/aide-manifest` | Drafts or refreshes a project's `.aide/project.yaml` manifest (stack, dependencies, deployment, docs)          |
| `/aide-reopen`   | Takes an archived spec back into the active list for another round, keeping the description and archive trail  |
| `/aide-reset`    | Resets an invalid active spec work round, keeping its README, description, commits and job history             |
| `/aide-to-pdf`   | Generates a PDF from a spec's documentation                                                                    |

---

## For end users

Clone the repo, then run the installer for your AI tool:

| AI tool        | Install                                  | Documentation                                        |
|----------------|------------------------------------------|------------------------------------------------------|
| Claude Code    | `implementations/claude-code/install.sh` | [INSTALL.md](implementations/claude-code/INSTALL.md) |
| GitHub Copilot | `implementations/copilot/install.sh`     | [INSTALL.md](implementations/copilot/INSTALL.md)     |
| Codex          | `implementations/codex/install.sh`       | [README.md](implementations/codex/README.md)         |

`./install-all.sh` runs all three at once. Each installer is self-contained: instructions, commands/prompts, scripts and
documentation, installed globally so any project can use them.

> **Windows users:** The scripts require WSL or Git Bash.
> See [WSL installation](https://learn.microsoft.com/en-us/windows/wsl/install).

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

The Aide dashboard can be used to keep track of every project that runs aide and run their 
specs workflow automatically. It lives in `dashboard/` folder and has its own documentation:
**[dashboard/README.md](dashboard/README.md)**.

---

## Resources

- [DEVELOPING.md](DEVELOPING.md) - Developer guide for Aide
- [core/skills/workflows/SKILL.md](core/skills/workflows/SKILL.md) - The spec workflow
- [core/rules/git.md](core/rules/git.md) - Git rules
