# Claude Code implementation

## Table of Contents

- [Overview](#overview)
- [Setup (first time)](#setup-first-time)
  - [Environment variables](#step-0-optional-configure-environment-variables)
  - [Install script](#step-1-run-the-install-script)
- [Daily use](#daily-use)
  - [Starting work on a spec](#starting-work-on-a-spec)
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
- Generic workflows: See `../../core/skills/workflows/SKILL.md`

---

## Overview

The skills let you:
- Create structured documentation in the `specs/` directory
- Analyze the codebase and generate solution proposals
- Implement with a TDD workflow (RED → GREEN → REFACTOR)

**📦 Installation:** See **[INSTALL.md](./INSTALL.md)** for the complete guide (5 min)

**Available skills:**
```bash
/aide-create Move forms off Redux Form        # Create the spec (the title is made from the description)
# → specs/55-move-forms-off-redux-form/, say

/aide-create TODO-redux-form-migration Move all forms off Redux Form
# → specs/55-redux-form-migration/ — the name given, not one made from the description

/aide-analyze 55                  # Analyze the codebase
/aide-implement 55                # Implement with TDD

# Utility
/aide-to-pdf 55                   # Generate PDF document
```

**Result of /aide-create:**
- ✅ Document structure created in specs/<NN>-slug/
- ✅ 1-description.md filled in with the title and the description
- ✅ Empty files: 2-analysis.md, 3-solution.md, 4-status.md

**Result of /aide-analyze:**
- ✅ Codebase analyzed (via @agent-task-analyzer)
- ✅ All 4 document files updated with analysis and solution proposals
- ✅ Concrete files and line numbers identified

**Architecture:**
```text
/aide-create <description> → Creates the spec
    ↓
/aide-analyze 55 → @agent-task-analyzer
    ↓
    Analyzes codebase (Explore agent)
    ↓
    Updates documentation
    ↓
/aide-implement 55 → @agent-tdd-implementer
    ↓
    RED → GREEN → REFACTOR (with user confirmation)
```

---

## Setup (first time)

### Step 0: (Optional) Configure environment variables

**Before running the setup script**, you can set environment variables to customize the setup:

#### AIDE_SPECS_PATH - Store specs outside the workspace

**Use this if you want to:**
- Store specs in your own private git repo
- Use cloud storage (Dropbox, iCloud, etc.)
- Separate workspace code from user-specific specs

```text
# <project>/.aide/config
AIDE_SPECS_PATH=/Users/you/develop/my-specs-repo
```

**If not set:** specs are written to `specs/` in the project root. The
key is per-project configuration in `.aide/config`, not an environment
variable.

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
cd aide/implementations/claude-code
./install.sh
```

**The script installs globally:**
- ✅ Scripts → `~/.local/bin/` (`aide-generate-pdf`, `aide-generate-html`, `upgrade-ai-tools`)
- ✅ Skills, agents and rules → `~/.claude/`
- ✅ LSP plugins (typescript, kotlin, jdtls)

Run `./install.sh` again to update after changes.


---

## Daily use

### Starting work on a spec

1. **Start Claude Code** (in any project: my-app, Aide, my-api, etc.)

2. **Create the spec** — a title and a description:
   ```bash
   /aide-create Move all forms from Redux Form to React Hook Form
   ```
   → Generates `specs/55-move-all-forms-from-redux-form-to-react-hook-form/`, say.

   With a name of your own instead of one made from the description:
   ```bash
   /aide-create TODO-redux-form-migration Move all forms from Redux Form to React Hook Form
   ```
   → Generates `specs/55-redux-form-migration/`.

   A title that begins with an issue key (`PROJ-7637 …`) keeps the key in
   the folder name, and every later command accepts that key in place of
   the number.

3. **Claude will automatically:**
   - Create the document structure
   - Fill in `1-description.md` with the title and the description
   - Commit and push the new folder

4. **Analyze the codebase:**
   ```bash
   /aide-analyze 55
   ```

5. **Read the documentation:**
   ```bash
   cat specs/55-*/2-analysis.md
   cat specs/55-*/3-solution.md
   ```

6. **Implement the solution (optional):**
   ```bash
   /aide-implement 55
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

### Denying direct Write/Edit against spec files

Since spec 282, every legitimate spec-file write goes through
`aide-create-spec`, `aide-write-spec` or `aide-archive-spec` — never the
`Write`/`Edit` tool directly. That means a `Write`/`Edit` permission rule
scoped to a project's specs root can deny every such call outright, with
no legitimate case left to break.

A project's specs root is personal (`AIDE_SPECS_PATH` lives in the
gitignored `.aide/config`), so `install.sh` cannot compute or write this
rule for every contributor. Run `aide-print-specs-guard` from inside the
project instead — it prints a ready-to-paste `deny` snippet scoped to
that project's own specs root, for you to paste into the `"permissions":
{ "deny": [...] }` array of `~/.claude/settings.json` (Aide never edits
that file itself).

---

## Files and structure

### Config files (source of truth in git)

```text
aide/
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
    └── agents/                         # Specialized agents

aide/
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
aide/specs/
├── 55-move-forms-off-redux-form/
│   ├── 1-description.md     # Generated by /aide-create
│   ├── 2-analysis.md         # Generated by /aide-analyze
│   ├── 3-solution.md         # Generated by /aide-analyze
│   └── 4-status.md          # Generated by /aide-analyze
└── 56-<slug>/
    └── [same structure]
```

---

## How it works

### 1. Unified /aide-* skills

**`/aide-create <description>`**
1. Creates the document structure (4 files)
2. Fills in 1-description.md with the title and the description

**`/aide-analyze <number>`**
1. Analyzes the codebase with the Explore agent (@agent-task-analyzer)
2. Identifies affected files (with line numbers)
3. Updates all 4 document files

**`/aide-implement <number>`**
1. Reads 2-analysis.md and 3-solution.md
2. Implements with TDD (RED → GREEN → REFACTOR)
3. Updates 4-status.md along the way

**`/aide-to-pdf <number>`**
1. Combines all markdown files (1-4) into one document
2. Adds a cover page with metadata
3. Converts to PDF with header/footer
4. Output: `<docs-folder>/<NN-slug>.pdf`

---

## Tips and tricks

### See all specs you have worked on

```bash
ls -lt ../aide/specs/
```

### Re-analyze when the codebase changes

```bash
# If the codebase has changed since the last analysis
/aide-analyze 55
```

---

## Example flow

```bash
# 1. Create the spec
/aide-create Move all forms from Redux Form to React Hook Form

# Claude creates the document structure — number 55, say

# 2. Analyze the codebase
/aide-analyze 55

# Claude analyzes the codebase and updates the documentation

# 3. Read the documentation
cat ../aide/specs/55-*/2-analysis.md
cat ../aide/specs/55-*/3-solution.md

# 4. Implement the solution (optional - TDD-assisted)
/aide-implement 55

# Or code manually based on the documentation

# 5. Generate a PDF for sharing/archiving (optional)
/aide-to-pdf 55

# Open the PDF
open ../aide/specs/55-*/55-*.pdf
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

| Flag                          | Description                                     |
|-------------------------------|-------------------------------------------------|
| `-p "prompt"`                 | Headless mode - runs without the interactive UI |
| `--allowedTools`              | Grants permissions without user input           |
| `--output-format json`        | JSON output for parsing                         |
| `--output-format stream-json` | Streaming JSON for multi-turn                   |

---

## Resources

**Official documentation and best practices:**

- [Anthropic: Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices) - Official tips for effective use
- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code) - Complete documentation
- [CLI Reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage) - All CLI flags including headless mode
- [Anthropic Prompt Engineering](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering) - Prompting techniques
