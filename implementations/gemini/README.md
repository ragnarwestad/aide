# Google Gemini CLI - Implementation Guide

## Table of Contents

- [Overview](#overview)
- [What is the Gemini CLI?](#what-is-the-gemini-cli)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
  - [VS Code integration](#vs-code-integration-gemini-code-assist)
- [Usage](#usage)
  - [Slash Commands](#slash-commands)
  - [JIRA workflow](#jira-workflow)
  - [TDD workflow](#tdd-workflow)
- [Slash Commands (details)](#slash-commands)
- [Prompt templates](#prompt-templates)
- [VS Code Tasks](#vs-code-tasks)
- [Tips and tricks](#tips-and-tricks)
- [Limitations](#limitations)
- [Comparison with Claude Code](#comparison-with-claude-code)

---

## Overview

This implementation lets you use the **Google Gemini CLI** to follow the same workflows as Claude Code, with terminal-based AI assistance.

**Architecture:**
```text
implementations/gemini/
├── README.md                           # This file
├── GEMINI.md                           # Custom instructions (copied to the workspace)
└── .gemini/
    └── commands/                       # Slash commands (TOML format)
        ├── aide-create.toml           # /aide-create
        ├── aide-analyze.toml          # /aide-analyze
        ├── aide-implement.toml               # /aide-implement
        ├── aide-make-tests.toml        # /aide-make-tests
        └── aide-react-class-to-func.toml # /aide-react-class-to-func
```

**Reuses:**
- `core/rules/` - Same workflows, git rules, testing rules
- `core/templates/` - Same 4-file document structure
- `core/scripts/` - Same scripts (aide-generate-pdf, etc.)

---

## What is the Gemini CLI?

The **Gemini CLI** is an open-source AI tool from Google that can:
- Run locally in the terminal with access to the file system
- Navigate the repo, edit files, run commands
- Use Google Search for up-to-date information
- Integrate with MCP (Model Context Protocol) for extensions
- Save and resume conversations (checkpointing)

**Model:**
- Gemini 3 (default, 1M token context window)
- Gemini 3.x Flash / Flash-Lite for faster/cheaper usage

**Free tier:**
- 60 requests/minute
- 1000 requests/day
- Gemini 3 with 1M token context window

**Open source:**
- Apache 2.0 license
- https://github.com/google-gemini/gemini-cli

---

## Prerequisites

### 1. Google account

- Personal Google account (free tier)
- Or paid tier (Google AI Pro/Ultra) for higher limits
- Or paid API key

### 2. Node.js 20+

```bash
# Check version
node --version
# Must be 20.x or higher
```

---

## Installation

### Step 1: Install the Gemini CLI

```bash
# Via npm (recommended)
npm install -g @google/gemini-cli

# Via Homebrew (macOS)
brew install gemini-cli

# Or run without installing
npx https://github.com/google-gemini/gemini-cli
```

### Step 2: Authenticate

```bash
# Start the Gemini CLI - authentication happens automatically
gemini

# Follow the instructions to log in with a Google account
```

### Step 3: Copy GEMINI.md to the workspace

```bash
# From the doc-aide workspace root
cp implementations/gemini/GEMINI.md ./GEMINI.md
```

The Gemini CLI automatically reads `GEMINI.md` in the project root on startup.

---

## Configuration

### GEMINI.md

The Gemini CLI automatically reads `GEMINI.md`, which contains:

- Workspace concept and structure
- References to `core/rules/workflows.md`
- TDD rules from `core/rules/testing.md`
- Git rules from `core/rules/git.md`
- Documentation standard from `core/rules/documentation.md`

### Environment variables

```bash
# Add to ~/.bashrc or ~/.zshrc
export AIDE_INSTALLATION_PATH="/Users/$(whoami)/develop/doc-aide"

# Optional: Separate reports path
export AIDE_REPORTS_PATH="/Users/$(whoami)/Documents/aide-reports"
```

### Global settings

Gemini CLI settings are stored in `~/.gemini/settings.json`:

```json
{
  "theme": "dark",
  "mcpServers": {}
}
```

### VS Code integration (Gemini Code Assist)

As an alternative to terminal-based usage, you can use **Gemini Code Assist** in VS Code. This gives you access to Gemini functionality directly in the editor.

**Installation:**

1. Open VS Code Extensions (`Cmd+Shift+X` / `Ctrl+Shift+X`)
2. Search for "Gemini Code Assist"
3. Install the extension from Google
4. Log in with a Google account

**Features in VS Code:**

| Feature | Terminal (Gemini CLI) | VS Code (Code Assist) |
|----------|----------------------|----------------------|
| Chat | ✅ Fully functional | ✅ Sidebar chat |
| Slash commands | ✅ Native (`.toml`) | ❌ Not supported |
| File editing | ✅ Full access | ✅ Inline suggestions |
| Terminal commands | ✅ Full access | ⚠️ Limited |
| GEMINI.md | ✅ Auto-read | ❌ Not read |
| Context window | ✅ 1M tokens | ⚠️ Varies |

**Recommendation:**

- **Use the Gemini CLI** for JIRA workflows, TDD, and complex analyses
- **Use Code Assist** for inline code completion and quick questions in VS Code

**Note:** Gemini Code Assist agent mode in VS Code is "powered by Gemini CLI" and shares quotas with the terminal version.

---

## Usage

### Slash Commands

The Gemini CLI supports slash commands via TOML files in `.gemini/commands/`.

**Available commands:**

| Command | Description |
|----------|-------------|
| `/aide-create <ID>` | Create the document structure for a JIRA issue or TODO plan |
| `/aide-analyze <ID>` | Analyze the codebase and identify affected files |
| `/aide-implement <ID>` | Implement the solution with TDD (RED-GREEN-REFACTOR) |
| `/aide-make-tests <file>` | Create missing unit tests for a file |
| `/aide-react-class-to-func <file>` | Convert a React class to a functional component |

**Usage:**

```bash
# Start the Gemini CLI
gemini

# Use slash commands
> /aide-create PROJ-7890
> /aide-analyze PROJ-7890
> /aide-implement PROJ-7890

# TODO workflow
> /aide-create todo-01
> /aide-analyze todo-01
> /aide-implement todo-01

# Utility commands
> /aide-make-tests src/utils/country.ts
> /aide-react-class-to-func src/components/UserProfile.tsx
```

**Installing slash commands:**

```bash
# Copy the .gemini/ directory to the workspace root
cp -r implementations/gemini/.gemini ./
```

---

### JIRA workflow

#### 1. Create JIRA documentation

**Instead of:** `/aide-create PROJ-7890` (Claude Code)

**With the Gemini CLI:**

```bash
# Start an interactive session
gemini

# Then:
> Create structured documentation for JIRA issue PROJ-7890:
>
> 1. Create directory: reports/<NN>-PROJ-7890-slug/
> 2. Follow core/rules/documentation.md
> 3. Use templates from core/templates/todo/
> 4. Fill in 1-description.md with JIRA metadata (user pastes in data)
> 5. Create empty files: 2-analysis.md, 3-solution.md, 4-status.md
> 6. Stage all new files in git
```

**Or directly from the terminal:**
```bash
gemini -p "Fetch JIRA issue PROJ-7890 and create documentation"
```

#### 2. Analyze the codebase

**Instead of:** `/aide-analyze PROJ-7890` (Claude Code)

**With the Gemini CLI:**

```bash
gemini -p "Analyze the codebase for JIRA issue PROJ-7890:

1. Read reports/<NN>-PROJ-7890-slug/1-description.md
2. Search the codebase for relevant files
3. Identify affected components (file:line)
4. Check API impact (frontend ↔ backend)
5. Assess complexity (simple/medium/complex)
6. Update 2-analysis.md with findings
7. Create an implementation plan in 3-solution.md
8. Follow the core/rules/workflows.md structure"
```

#### 3. Implement with TDD

**Instead of:** `/aide-implement PROJ-7890` (Claude Code)

**With the Gemini CLI:**

```bash
gemini -p "Implement the solution for PROJ-7890 with TDD:

RED PHASE:
1. Read 3-solution.md -> Step 0: Write tests
2. Create test files as described
3. Run: pnpm test -- --run <testfile>
4. Verify that the tests FAIL
5. Stop and ask for confirmation

GREEN PHASE:
1. Implement Steps 1-N from 3-solution.md
2. Run tests after each step
3. Verify that all tests PASS
4. Stop and ask for confirmation

REFACTOR PHASE:
1. Run: pnpm test -- --run (all tests)
2. Run: npx tsc --noEmit
3. Run: pnpm run eslint
4. Update 4-status.md with the result

Follow the project's coding standard for all code."
```

### TDD workflow

The Gemini CLI supports the TDD cycle:
- Writes tests first (RED)
- Implements until tests pass (GREEN)
- Refactors and verifies (REFACTOR)
- Iterates automatically on failures

---

## Prompt templates

Slash commands live in `.gemini/commands/*.toml` and work natively in a `gemini` session:

| Command | Purpose |
|----------|--------|
| `/aide-create` | Create JIRA/TODO documentation |
| `/aide-analyze` | Analyze the codebase |
| `/aide-implement` | Implement with TDD |
| `/aide-make-tests` | Create missing unit tests |
| `/aide-react-class-to-func` | Convert class to functional |

**Usage:**
```bash
# In a gemini session:
/aide-create PROJ-7890
```

---

## VS Code Tasks

VS Code Tasks make it easy to start Gemini workflows directly from VS Code.

**Available tasks:**

| Task | Description |
|------|-------------|
| `Gemini: Start interactive session` | Open the Gemini CLI in a terminal |
| `Gemini: Create JIRA documentation` | Create the 4-file structure for a JIRA issue |
| `Gemini: Analyze codebase` | Analyze affected files |
| `Gemini: Implement with TDD` | Implement with RED-GREEN-REFACTOR |

**Usage:**

1. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Select "Tasks: Run Task"
3. Select the desired Gemini task
4. Enter the JIRA ID when prompted

**Alternatively:** Use `Cmd+Shift+B` / `Ctrl+Shift+B` to run build tasks.

---

## Tips and tricks

### 1. Use Google Search grounding

The Gemini CLI can search the web for up-to-date information:

```bash
gemini -p "Search for best practices for React 19 hooks and summarize"
```

### 2. Include multiple directories

```bash
gemini --include-directories ../my-api,../my-app
```

### 3. Save and resume conversations

```bash
# Gemini automatically saves conversations
# Use /chat to manage them

gemini
> /chat list      # Show previous conversations
> /chat load 123  # Load a conversation
```

### 4. Use MCP servers

Configure MCP servers in `~/.gemini/settings.json` for extended functionality.

### 5. Be explicit about context

**Bad:**
```bash
gemini -p "Analyze PROJ-7890"
```

**Good:**
```bash
gemini -p "Analyze PROJ-7890 by following core/rules/workflows.md.
First read 1-description.md, then search the codebase,
and update 2-analysis.md with findings (file:line)."
```

---

## Limitations

### The Gemini CLI does NOT have:

- Built-in agents like `@agent-jira-analyzer` (but you can use slash commands)
- IDE integration on the same level as Copilot

### The Gemini CLI DOES have:

- Terminal-based CLI (open source)
- Google Search grounding
- MCP support for extensions
- Conversation checkpointing
- 1M token context window (free)
- Multimodal support (images, etc.)

### Costs:

- **Free tier:** 60 req/min, 1000 req/day
- **API:** Prices vary, see Google AI Studio
- **Google AI Pro/Ultra:** Higher limits and access to top models

### Workarounds:

1. **Slash commands:** Use `.gemini/commands/` (TOML files)
2. **Auto-read CLAUDE.md - GEMINI.md:** Configure `GEMINI.md` in the project root
3. **Agents - Explicit prompts:** Ask Gemini to follow specific workflows

---

## Comparison with Claude Code

| Feature | Claude Code | Gemini CLI |
|---------|-------------|------------|
| **Commands** | Slash commands (`.md`) | Slash commands (`.toml`) |
| **Instructions** | CLAUDE.md (auto-read) | GEMINI.md (auto-read) |
| **Agents** | `@agent-jira-analyzer` | Slash commands |
| **TDD** | Built-in RED-GREEN-REFACTOR | Supports the TDD cycle |
| **Codebase analysis** | Yes | Yes |
| **Tool calling** | Yes | Yes |
| **Web search** | No | Yes (Google Search) |
| **MCP support** | Yes | Yes |
| **Context window** | 200K tokens | 1M tokens |
| **Open source** | No | Yes (Apache 2.0) |
| **Price** | Limited free | Generous free tier |

### When to use what?

| Scenario | Recommendation |
|----------|-----------|
| **Large context (many files)** | Gemini CLI (1M tokens) |
| **Up-to-date web info** | Gemini CLI (Google Search) |
| **Slash commands workflow** | Claude Code |
| **Open source preference** | Gemini CLI |
| **TDD implementation** | Both work well |
| **IDE integration** | Claude Code / Copilot |

---

## Next steps

1. Install the Gemini CLI
2. Authenticate with a Google account
3. Copy GEMINI.md to the workspace
4. Test with a simple JIRA issue

---

## Headless Mode (Automation)

The Gemini CLI supports headless mode for automation, CI/CD and scripting.

### Basic usage

```bash
# Run a single prompt without the interactive UI
gemini -p "Analyze this code and suggest improvements"

# With JSON output for programmatic parsing
gemini -p "List all TypeScript files in src/" -o json

# YOLO mode - no confirmations (full automation)
gemini -p "Run all tests" -y
```

### E2E Testing

```bash
# Test that the Gemini CLI works
gemini -p "Say 'hello'" -o json

# Run the aide workflow headless
gemini -p "/aide-create PROJ-TEST" -y
```

### Flags for automation

| Flag | Description |
|-------|-------------|
| `-p "prompt"` | Headless mode - run without the interactive UI |
| `-o json` | JSON output for parsing |
| `-y` / `--yolo` | No confirmations (full automation) |

**Note:** Custom commands (`.toml`) have limited support in headless mode for now.

---

## Resources

**Official documentation:**

- [Gemini CLI GitHub](https://github.com/google-gemini/gemini-cli) - Open source repo
- [Google Developers - Gemini CLI](https://developers.google.com/gemini-code-assist/docs/gemini-cli) - Official documentation
- [Gemini CLI Hands-on Codelab](https://codelabs.developers.google.com/gemini-cli-hands-on) - Interactive tutorial

**Headless mode and automation:**

- [Headless Mode - Gemini CLI Docs](https://google-gemini.github.io/gemini-cli/docs/cli/headless.html) - Official headless documentation

---

**Good luck with the Gemini CLI!**
