# aide

A structured workspace for AI-assisted development. Supports Claude Code, GitHub Copilot and Codex.

## Table of contents

- [Vision](#vision)
- [For end users](#for-end-users)
- [For aide developers](#for-aide-developers)
- [Environment variables](#environment-variables)
  - [AIDE_INSTALLATION_PATH](#aide_installation_path-required-for-dist-packages)
  - [AIDE_PROJECTS_PATH](#aide_projects_path-optional)
  - [AIDE_SPECS_PATH](#aide_specs_path-optional)
- [AI-assisted workflow](#ai-assisted-workflow)
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

### AIDE_SPECS_PATH (optional)

Store specs (JIRA analyses, TODO plans) outside the workspace.

```bash
export AIDE_SPECS_PATH="/Users/$(whoami)/Documents/aide-specs"
```

**Default:** Specs are written to `aide/specs/` (gitignored).

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

## Resources

- [DEVELOPING.md](DEVELOPING.md) - Developer guide for aide
- [core/rules/workflows.md](core/rules/workflows.md) - JIRA/TODO workflows
- [core/rules/git.md](core/rules/git.md) - Git rules
