# JIRA integration for Claude Code

## Table of Contents

- [Overview](#overview)
- [Setup (first time)](#setup-first-time)
  - [Environment variables](#step-0-optional-configure-environment-variables)
  - [Install script](#step-1-run-the-install-script)
- [Daily use](#daily-use)
  - [JIRA issue](#starting-work-on-a-new-jira-issue)
  - [TODO plan](#starting-work-on-a-todo-plan)
- [Troubleshooting](#troubleshooting)
- [Files and structure](#files-and-structure)
- [How it works](#how-it-works)
- [Tips and tricks](#tips-and-tricks)
- [Headless Mode](#headless-mode)
- [Resources](#resources)

---

This directory contains the Claude Code implementation with configuration files, skills and agents.

**References:**
- Claude Code instructions: See `CLAUDE.md`
- Agent documentation: See `agents/README.md`
- Generic workflows: See `../../core/rules/workflows.md`

---

## Overview

The JIRA integration lets you automatically:
- Create structured documentation in the `reports/` directory
- Analyze the codebase and generate solution proposals
- Implement with a TDD workflow (RED → GREEN → REFACTOR)

**📦 Installation:** See **[INSTALL.md](./INSTALL.md)** for the complete guide (5 min)

**Available skills:**
```bash
# JIRA workflow (detected automatically from the PROJ-* prefix)
/aide-create PROJ-7637           # Create document structure
/aide-analyze PROJ-7637          # Analyze codebase
/aide-implement PROJ-7637               # Implement with TDD

# TODO workflow (with todo- prefix)
/aide-create todo-redux-form-migration Move forms off Redux Form
# → Generates: todo-01-redux-form-migration

/aide-create todo Move forms      # Auto-generated slug
# → Generates: todo-01-move-forms

/aide-analyze todo-01               # Analyze (shorthand - searches for todo-01-*)
/aide-implement todo-01                    # Implement (shorthand)

# Utility
/aide-to-pdf PROJ-7637            # Generate PDF document
```

**Result of /aide-create (JIRA mode):**
- ✅ Document structure created in reports/<NN>-PROJ-7637-slug/
- ✅ 1-description.md filled in with JIRA metadata + description
- ✅ Empty files: 2-analysis.md, 3-solution.md, 4-status.md

**Result of /aide-analyze:**
- ✅ Codebase analyzed (via @agent-jira-analyzer or @agent-todo-analyzer)
- ✅ All 4 document files updated with analysis and solution proposals
- ✅ Concrete files and line numbers identified

**Architecture:**
```text
/aide-create PROJ-7637 → Creates document structure
    ↓
/aide-analyze PROJ-7637 → @agent-jira-analyzer
    ↓
    Analyzes codebase (Explore agent)
    ↓
    Updates documentation
    ↓
/aide-implement PROJ-7637 → @agent-tdd-implementer
    ↓
    RED → GREEN → REFACTOR (with user confirmation)
```

---

## Setup (first time)

### Step 0: (Optional) Configure environment variables

**Before running the setup script**, you can set environment variables to customize the setup:

#### AIDE_REPORTS_PATH - Store reports outside the workspace

**Use this if you want to:**
- Store reports in your own private git repo
- Use cloud storage (Dropbox, iCloud, etc.)
- Separate workspace code from user-specific reports

```bash
# In ~/.zshrc or ~/.bashrc
export AIDE_REPORTS_PATH="/Users/$(whoami)/Documents/aide-reports"
# or
export AIDE_REPORTS_PATH="/Users/$(whoami)/Dropbox/aide-reports"

# Load the changes
source ~/.zshrc  # or source ~/.bashrc
```

**If not set:** Reports are written to `doc-aide/reports/` (default, gitignored)

#### AIDE_PROJECTS_PATH - Permissions without prompts

Set (optionally) so that Claude Code generates absolute paths in permissions:

```bash
# In ~/.zshrc or ~/.bashrc
export AIDE_PROJECTS_PATH="/Users/$(whoami)/develop"

# Load the changes
source ~/.zshrc  # or source ~/.bashrc
```

---

### Step 1: Run the install script

```bash
cd doc-aide/implementations/claude-code
./install.sh
```

**The script installs globally:**
- ✅ Scripts → `~/.local/bin/` (`aide-generate-pdf`, `aide-generate-html`, `upgrade-ai-tools`)
- ✅ Skills, agents and rules → `~/.claude/`
- ✅ LSP plugins (typescript, kotlin, jdtls)

Run `./install.sh` again to update after changes.


---

## Daily use

### Starting work on a new JIRA issue

1. **Find the JIRA issue number** (e.g. PROJ-7637)

2. **Start Claude Code** (in any project: my-app, doc-aide, my-api, etc.)

3. **Run the slash command:**
   ```bash
   /aide-create PROJ-7637
   ```

4. **Claude will automatically:**
   - Create the document structure: `../doc-aide/reports/<NN>-PROJ-7637-slug/`
   - Fill in `1-description.md` with JIRA metadata
   - Give you a summary

5. **Analyze the codebase:**
   ```bash
   /aide-analyze PROJ-7637
   ```

6. **Read the documentation:**
   ```bash
   cat ../doc-aide/reports/<NN>-PROJ-7637-slug/2-analysis.md
   cat ../doc-aide/reports/<NN>-PROJ-7637-slug/3-solution.md
   ```

7. **Implement the solution (optional):**
   ```bash
   /aide-implement PROJ-7637
   ```

### Starting work on a TODO plan

1. **Start Claude Code** (in any project)

2. **Create the TODO plan:**

   With an explicit name:
   ```bash
   /aide-create todo-redux-form-migration Move all forms from Redux Form to React Hook Form
   ```
   → Generates: `todo-01-redux-form-migration`

   Or auto-generated from the description:
   ```bash
   /aide-create todo Move forms to React Hook Form
   ```
   → Generates: `todo-01-move-forms-to-react-hook-form`

3. **Analyze (use shorthand):**
   ```bash
   /aide-analyze todo-01
   ```

   Or with the full ID:
   ```bash
   /aide-analyze todo-01-redux-form-migration
   ```

4. **Implement (use shorthand):**
   ```bash
   /aide-implement todo-01
   ```

---

## Troubleshooting

### Problem: `/aide-create` command not found

**Cause:** Skill not loaded or misplaced

**Solution:**
1. Check that the directory exists: `~/.claude/skills/aide-create/SKILL.md`
2. Restart Claude Code
3. Try again

### Problem: Documentation already exists

**This is OK!** `/aide-create` can be re-run to update 1-description.md.

### Problem: Claude asks for permissions even though they are set in settings.json

**Cause:** Claude Code expands relative paths to absolute paths, and permissions only match exactly.

**Solution:**

See **"Step 0: (Optional) Configure environment variables"** in the setup section.

Short version:
1. Set `AIDE_PROJECTS_PATH` in `~/.zshrc` or `~/.bashrc`
2. Run `source ~/.zshrc` to load it
3. Run `./install.sh` again

---

## Files and structure

### Config files (source of truth in git)

```text
doc-aide/
├── core/                               # Shared (used by all AI tools)
│   ├── rules/                          # Workflows, git, testing, standards
│   ├── skills/                         # Skills (SKILL.md)
│   ├── scripts/                        # CLI scripts (aide-generate-pdf etc.)
│   └── templates/                      # Document templates
│
└── implementations/claude-code/        # Claude Code implementation
    ├── README.md                       # This file
    ├── INSTALL.md                      # Installation guide
    ├── install.sh / uninstall.sh       # Global install/uninstall
    ├── settings.json                   # Template for ~/.claude/settings.json
    └── agents/                         # Agent definitions → ~/.claude/agents/
        ├── README.md
        └── *.md                        # Specialized agents
```

### Runtime files (installed locally, not in git)

```text
~/.local/bin/aide-generate-pdf               # Installed from core/scripts/
~/.local/bin/aide-generate-html              # Installed from core/scripts/
~/.local/bin/upgrade-ai-tools           # Installed from core/scripts/

$AIDE_PROJECTS_PATH/
├── CLAUDE.md                           # Shared AI instructions
└── .claude/                            # Shared configuration
    ├── settings.json                   # Permissions (absolute paths)
    ├── skills/                         # All skills (expert + aide-* workflows)
    │   ├── aide-create/SKILL.md
    │   ├── aide-analyze/SKILL.md
    │   ├── aide-implement/SKILL.md
    │   ├── tdd-coach/SKILL.md
    │   ├── my-app-expert/SKILL.md
    │   ├── my-api-expert/SKILL.md
    │   ├── task-workflow-assistant/SKILL.md
    │   └── architecture-advisor/SKILL.md
    └── agents/                         # Specialized agents

doc-aide/
├── CLAUDE.md → ../CLAUDE.md            # Symlink to shared file
└── .claude → ../.claude                # Symlink to shared configuration

my-app/
├── CLAUDE.md → ../CLAUDE.md            # Symlink to shared file
└── .claude → ../.claude                # Symlink to shared configuration

my-api/
├── CLAUDE.md → ../CLAUDE.md            # Symlink to shared file
└── .claude → ../.claude                # Symlink to shared configuration

my-docs/
├── CLAUDE.md → ../CLAUDE.md            # Symlink to shared file
└── .claude → ../.claude                # Symlink to shared configuration
```

### Output files (generated by commands - AI-agnostic)

```text
doc-aide/reports/
├── PROJ-7637/
│   ├── 1-description.md     # Generated by /aide-create
│   ├── 2-analysis.md         # Generated by /aide-analyze
│   ├── 3-solution.md         # Generated by /aide-analyze
│   └── 4-status.md          # Generated by /aide-analyze
└── PROJ-XXXX/
    └── [same structure]
```

---

## How it works

### 1. Unified /aide-* skills

**`/aide-create PROJ-XXXX`** (detects JIRA mode from the format)
1. Creates the document structure (4 files)
2. Fills in 1-description.md with JIRA metadata (the user pastes in JIRA data manually)

**`/aide-analyze PROJ-XXXX`**
1. Analyzes the codebase with the Explore agent (@agent-jira-analyzer)
2. Identifies affected files (with line numbers)
3. Updates all 4 document files

**`/aide-implement PROJ-XXXX`**
1. Reads 2-analysis.md and 3-solution.md
2. Implements with TDD (RED → GREEN → REFACTOR)
3. Updates 4-status.md along the way

**`/aide-to-pdf PROJ-XXXX`**
1. Combines all markdown files (1-4) into one document
2. Adds a cover page with metadata
3. Converts to PDF with header/footer
4. Output: `<docs-folder>/PROJ-XXXX.pdf`

---

## Tips and tricks

### See all JIRA issues you have worked on

```bash
ls -lt ../doc-aide/reports/
```

### Re-analyze when the codebase changes

```bash
# If the codebase has changed since the last analysis
/aide-analyze PROJ-7890
```

---

## Example flow

```bash
# 1. Create documentation (auto-detects JIRA from the PROJ format)
/aide-create PROJ-7890

# Claude fetches the issue and creates the document structure

# 2. Analyze the codebase
/aide-analyze PROJ-7890

# Claude analyzes the codebase and updates the documentation

# 3. Read the documentation
cat ../doc-aide/reports/<NN>-PROJ-7890-slug/2-analysis.md
cat ../doc-aide/reports/<NN>-PROJ-7890-slug/3-solution.md

# 4. Implement the solution (optional - TDD-assisted)
/aide-implement PROJ-7890

# Or code manually based on the documentation

# 5. Generate a PDF for sharing/archiving (optional)
/aide-to-pdf PROJ-7890

# Open the PDF
open ../doc-aide/reports/<NN>-PROJ-7890-slug/PROJ-7890.pdf
```

---

## Headless Mode

Claude Code supports headless mode (the `-p` flag) for non-interactive execution:

```bash
# Basic headless mode
claude -p "Say hello"

# With tool permissions (avoids confirmations)
claude -p "List files" --allowedTools "Bash,Read,Write,Edit"

# With JSON output for programmatic parsing
claude -p "Analyze this code" --output-format json

# With streaming JSON for multi-turn
claude -p "Complex task" --output-format stream-json
```

**Important flags:**

| Flag | Description |
|------|-------------|
| `-p "prompt"` | Headless mode - runs without the interactive UI |
| `--allowedTools` | Grants permissions without user input |
| `--output-format json` | JSON output for parsing |
| `--output-format stream-json` | Streaming JSON for multi-turn |

---

## Resources

**Official documentation and best practices:**

- [Anthropic: Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices) - Official tips for effective use
- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code) - Complete documentation
- [CLI Reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage) - All CLI flags including headless mode
- [Anthropic Prompt Engineering](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering) - Prompting techniques
