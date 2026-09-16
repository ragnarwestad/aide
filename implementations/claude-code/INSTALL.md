# Installation Guide - aide-claude-code

## Quick Start

```bash
# 1. Clone Aide
cd ~/develop
git clone <repo-url> aide

# 2. Run the installer
aide/implementations/claude-code/install.sh

# 3. Start Claude Code in a project
cd ~/develop/my-app
claude
```

**Test:** Run `/aide-create "A test spec" Just checking that the flow works.` in Claude Code.

---

## Prerequisites

- **Claude Code CLI** installed (the `claude` command works)
- **`jq`** (`brew install jq`) — every spec script needs it
- **[mise](https://mise.jdx.dev)** with a node installed, for the shared tools the installer adds (optional: skipped with a warning)
- **Mac/Linux** or **Windows with WSL** (bash scripts require a Unix shell)

> **Windows users:** The scripts are bash scripts and require [WSL (Windows Subsystem for Linux)](https://learn.microsoft.com/en-us/windows/wsl/install) or Git Bash. Run `wsl --install` in PowerShell to install WSL.

---

## What does install.sh do?

1. **Checks** which tools are on PATH (`aide-preflight`) — a missing one is reported, never fatal.
2. **Installs the scripts** to `~/.local/bin/`: every `core/scripts/aide-*` script (`aide-run-spec`,
   `aide-create-spec`, `aide-archive-spec`, `aide-generate-pdf`, `aide-generate-html`, …), their
   library under `~/.local/bin/lib/`, the git hooks, and `upgrade-ai-tools`.
3. **Installs the shared tools** through mise: markdownlint-cli2, jq, gh, bun, pandoc, md-to-pdf.
4. **Puts `~/.local/bin` on PATH** in `~/.zshenv` and `~/.bashrc`, so non-interactive shells (ssh,
   launchd) find the scripts too.
5. **Installs globally** to `~/.claude/`: every skill in `core/skills/` → `skills/`, the agents →
   `agents/`, the always-on rules → `rules/`.
6. **Installs the LSP plugins** (typescript, kotlin, jdtls) when the `claude` CLI is present.

Run it again to update; it replaces what it installed and removes what it no longer ships.

### Skills

Every skill in `core/skills/` is installed: the `aide-*` workflow skills (`aide-create`,
`aide-analyze`, `aide-implement`, `aide-archive`, `aide-explore`, `aide-manifest`, `aide-reopen`,
`aide-reset`, `aide-close`, `aide-to-pdf`) and the expertise skills Claude Code activates by context
(`tdd-coach`, `task-workflow-assistant`, `documentation`, `markdown-linting`, `spec-structure`,
`tools-and-scripts`, `unit-tests`, `playwright-e2e`, `workflows`).

---

## Per-project configuration

### AIDE_SPECS_PATH (optional, per project)

```text
# <project>/.aide/config
AIDE_SPECS_PATH=$HOME/develop/my-specs-repo
```

Where that project's specs are stored. If not set, `specs/` in the project root is used.
Per-project configuration — not an environment variable.

---

## LSP plugins (semantic code understanding)

Claude Code has built-in support for LSP plugins that provide semantic code navigation
(symbol search, find references, refactoring). These are installed automatically by `install.sh`.

**Installed plugins:**

| Plugin           | Language              |
|------------------|-----------------------|
| `typescript-lsp` | TypeScript/JavaScript |
| `kotlin-lsp`     | Kotlin                |
| `jdtls-lsp`      | Java                  |

**Manual installation** (if needed):

```bash
claude plugin install typescript-lsp@claude-plugins-official
claude plugin install kotlin-lsp@claude-plugins-official
claude plugin install jdtls-lsp@claude-plugins-official
```

## Available skills

### Slash commands (skills in Claude Code)

| Command                                | Description        |
|----------------------------------------|--------------------|
| `/aide-create "<title>" <description>` | Create a spec      |
| `/aide-analyze <number>`               | Analyze codebase   |
| `/aide-implement <number>`             | Implement with TDD |

### Terminal scripts

| Script               | Description               |
|----------------------|---------------------------|
| `aide-generate-pdf`  | Generate PDF from a spec  |
| `aide-generate-html` | Generate HTML from a spec |
| `upgrade-ai-tools`   | Update the AI CLIs        |

Document creation happens via the slash command `/aide-create` (not a terminal script).

---

## Troubleshooting

### "/aide-create command not found"

```bash
# Run install again, then restart Claude Code
aide/implementations/claude-code/install.sh
```

---

## Updating

```bash
cd aide && git pull
implementations/claude-code/install.sh
```

---

## Further reading

- `README.md` - Overview
- `CLAUDE.md` - AI instructions
- `core/skills/workflows/SKILL.md` - Workflows
- `core/rules/git.md` - Git rules
