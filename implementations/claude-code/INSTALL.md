# Installation Guide - aide-claude-code

## Quick Start

```bash
# 1. Unpack the zip file
cd ~/develop
unzip aide-claude-code.zip
cd aide-claude-code

# 2. Set environment variables (add to ~/.zshrc)
export AIDE_PROJECTS_PATH="$HOME/develop"

# 3. Run install
./install.sh

# 4. Start Claude Code in a project
cd $AIDE_PROJECTS_PATH/my-app
claude
```

**Test:** Run `/aide-create PROJ-7637` in Claude Code.

---

## Prerequisites

- **Claude Code CLI** installed (the `claude` command works)
- **Python 3.8+** (for scripts)
- **Access to JIRA** (https://jira.example.com)
- **Mac/Linux** or **Windows with WSL** (bash scripts require a Unix shell)

> **Windows users:** The scripts are bash scripts and require [WSL (Windows Subsystem for Linux)](https://learn.microsoft.com/en-us/windows/wsl/install) or Git Bash. Run `wsl --install` in PowerShell to install WSL.

---

## What does install.sh do?

1. **Installs scripts** to `~/.local/bin/`:
   - `aide-generate-pdf`, `aide-generate-html` - PDF/HTML export
   - `upgrade-ai-tools` - Updates the AI CLIs

2. **Installs globally** to `~/.claude/`:
   - `skills/` - skills (experts + aide-* workflows)
   - `agents/` - Specialized agents
   - `rules/` - Generic rules

3. **Installs LSP plugins** (typescript, kotlin, jdtls)

### Native Claude Code Skills

Skills are expertise modules that Claude Code activates automatically based on context:

```text
.claude/skills/
├── tdd-coach/SKILL.md               # Test-Driven Development
├── task-workflow-assistant/SKILL.md # JIRA/TODO analysis
```

**Example:** When you are about to implement new functionality, `tdd-coach` is activated automatically and guides Claude Code through RED → GREEN → REFACTOR.

---

## Environment Variables

### AIDE_PROJECTS_PATH (required)

```bash
export AIDE_PROJECTS_PATH="$HOME/develop"
```

The root directory where your projects live.

### AIDE_SPECS_PATH (optional, per project)

```text
# <project>/.aide/config
AIDE_SPECS_PATH=$HOME/develop/my-specs-repo
```

Where that project's JIRA documentation and TODO plans are stored. If not
set, `specs/` in the project root is used. Per-project configuration —
not an environment variable.

---

---

## LSP plugins (semantic code understanding)

Claude Code has built-in support for LSP plugins that provide semantic code navigation
(symbol search, find references, refactoring). These are installed automatically by `install.sh`.

**Installed plugins:**

| Plugin           | Language              | Used for |
|------------------|-----------------------|----------|
| `typescript-lsp` | TypeScript/JavaScript | my-app   |
| `kotlin-lsp`     | Kotlin                | my-api   |
| `jdtls-lsp`      | Java                  | my-api   |

**Manual installation** (if needed):

```bash
claude plugin install typescript-lsp@claude-plugins-official
claude plugin install kotlin-lsp@claude-plugins-official
claude plugin install jdtls-lsp@claude-plugins-official
```

### JIRA MCP (alternative to cookies)

If you have a JIRA MCP server, it can be used instead of cookie-based authentication.

---

## Available skills

### Slash commands (skills in Claude Code)

| Command                              | Description               |
|--------------------------------------|---------------------------|
| `/aide-create PROJ-XXXX`             | Create JIRA documentation |
| `/aide-create todo-name Description` | Create TODO plan          |
| `/aide-analyze PROJ-XXXX`            | Analyze codebase          |
| `/aide-implement PROJ-XXXX`          | Implement with TDD        |

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
# Verify that AIDE_PROJECTS_PATH is set
echo $AIDE_PROJECTS_PATH

# Run install again
cd /path/to/aide-claude-code
./install.sh

# Restart Claude Code
```

---

## Updating

To update to a new version:

1. Download the new zip package
2. Unpack (overwrites the old one)
3. Run `./install.sh` again

---

## Further reading

- `README.md` - Overview
- `CLAUDE.md` - AI instructions
- `core/skills/workflows/SKILL.md` - Workflows
- `core/rules/git.md` - Git rules
