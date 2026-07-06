# GitHub Copilot - Implementation Guide

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [What is Agent Mode?](#what-is-agent-mode)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
  - [Slash commands in Copilot CLI](#slash-commands-in-copilot-cli)
  - [JIRA workflow](#jira-workflow)
  - [TDD workflow](#tdd-workflow)
- [Tips and tricks](#tips-and-tricks)
- [Limitations](#limitations)
- [Comparison with Claude Code](#comparison-with-claude-code)
  - [Available models](#available-models)
  - [When to use what?](#when-to-use-what)

---

## Overview

This implementation lets you use **GitHub Copilot CLI** — which went [GA on February 25, 2026](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/) — and **Copilot Agent Mode in VS Code** to follow the same workflows as Claude Code.

**Copilot CLI** is a terminal-native coding agent with native slash commands, plan mode, autopilot mode and permanent permissions configuration. It reads **CLAUDE.md** and `.github/copilot-instructions.md` directly, which makes setup simpler than during the preview period.

**Architecture:**

```text
implementations/copilot/
├── README.md                           # This file
├── INSTALL.md                          # Detailed installation guide
├── install.sh                          # Installation script (executable)
└── uninstall.sh                        # Uninstallation script (executable)
```

**Reuses:**

- ✅ `core/AGENTS.md` - Generated instructions file (intro + core/rules/, shared with Codex)
- ✅ `core/rules/` - Same workflows, git rules, testing rules
- ✅ `core/templates/` - Same 4-file document structure
- ✅ `core/scripts/` - Same scripts (aide-generate-pdf, etc.)
- ✅ `implementations/claude-code/rules/` - Shared rules (git, testing, workflows, documentation)

---

## Quick Start

**First time?** Follow the installation guide:

```bash
# 1. Read the detailed installation guide
cat implementations/copilot/INSTALL.md

# 2. Run the install script
cd implementations/copilot
./install.sh
```

**Already installed?** Skip to [Usage](#usage).

---

## What is Agent Mode?

**Agent Mode** is GitHub Copilot's autonomous mode that can:
- ✅ Analyze the entire codebase for context
- ✅ Plan and execute multi-step solutions
- ✅ Run commands and tests
- ✅ Iterate until the solution is correct (RED → GREEN → REFACTOR)
- ✅ Auto-fix errors along the way

**Difference from regular Copilot:**
- Regular Copilot: Line-by-line code completion
- Agent Mode: Autonomous multi-step tasks

---

## Prerequisites

### 1. GitHub Copilot subscription

- GitHub Copilot Individual, Business, Pro or Enterprise
- Copilot CLI is available for all subscriptions

### 2. Copilot CLI (terminal)

```bash
# Install via npm (recommended)
npm install -g @github/copilot

# Or via Homebrew
brew install copilot-cli

# Or via curl
curl -fsSL https://gh.io/copilot-install | bash
```

### 3. VS Code with extensions (optional, for Agent Mode in the IDE)

```bash
# Install VS Code extensions
code --install-extension GitHub.copilot
code --install-extension GitHub.copilot-chat
```

---

## Installation

### Step 1: Install custom instructions

Run the install script — it installs `AGENTS.md` as global Copilot instructions
in `~/.copilot/copilot-instructions.md`:

```bash
cd implementations/copilot
./install.sh
```

Copilot CLI additionally reads **CLAUDE.md** directly from the project root.

### Step 2: Choose model and mode

**Copilot CLI:**

```bash
# Start Copilot CLI
copilot

# Choose model (in an interactive session)
/model
```

**VS Code Agent Mode:**

1. Open Copilot Chat in VS Code
2. Select **"agent"** from the chat mode dropdown
3. Configure tools via the tools button
4. Choose your preferred AI model

---

## Configuration

### Custom Instructions

The install script places `AGENTS.md` as global instructions in `~/.copilot/copilot-instructions.md`. It contains:

- 🎯 Workspace concept and structure
- 📋 References to `core/rules/workflows.md`
- 🧪 TDD rules from `core/rules/testing.md`
- 🔀 Git rules from `core/rules/git.md`
- 📝 Documentation standard from `core/rules/documentation.md`

Copilot will automatically follow these rules when you ask for help.

---

## Usage

### Slash commands in Copilot CLI

Copilot CLI reads the same skills as Claude Code (from `~/.claude/skills/` and
`~/.claude/commands/`), so slash commands work **natively** — no setup beyond
`install.sh`:

| Command | Function |
|----------|----------|
| `/aide-create` | Create JIRA documentation |
| `/aide-analyze` | Analyze codebase |
| `/aide-implement` | Implement with TDD |
| `/aide-make-tests` | Create tests for a file |
| `/aide-react-class-to-func` | Convert React class to functional |

Type the command in a `copilot` session, just like in Claude Code.

---

### JIRA workflow

#### 1. Create JIRA documentation

**Instead of:** `/aide-create PROJ-7890` (Claude Code)

**With Copilot (Agent Mode):**

```text
Create structured documentation for JIRA issue PROJ-7890:

1. Create directory: reports/<NN>-PROJ-7890-slug/
2. Follow core/rules/documentation.md
3. Use templates from core/templates/todo/
4. Fill in 1-description.md with JIRA metadata (user pastes in the data)
5. Create empty files: 2-analysis.md, 3-solution.md, 4-status.md
6. Stage all new files in git
```

#### 2. Analyze codebase

**Instead of:** `/aide-analyze PROJ-7890` (Claude Code)

**With Copilot (Agent Mode):**

```text
Analyze the codebase for JIRA issue PROJ-7890:

1. Read reports/<NN>-PROJ-7890-slug/1-description.md
2. Search the codebase for relevant files
3. Identify affected components (file:line)
4. Check API impact (frontend ↔ backend)
5. Assess complexity (simple/medium/complex)
6. Update 2-analysis.md with findings
7. Create an implementation plan in 3-solution.md
8. Follow the core/rules/workflows.md structure
```

#### 3. Implement with TDD

**Instead of:** `/aide-implement PROJ-7890` (Claude Code)

**With Copilot (Agent Mode):**

```text
Implement the solution for PROJ-7890 with TDD:

RED PHASE:
1. Read 3-solution.md → Step 0: Write tests
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

Follow the project's coding standard for all code.
```

### TDD workflow

Copilot's Agent Mode has built-in support for the TDD cycle:
- Writes tests first (RED)
- Implements until tests pass (GREEN)
- Refactors and verifies (REFACTOR)
- Iterates automatically on failure

---

---

## Tips and tricks

### 1. Be explicit about context

❌ **Bad:**
```text
Analyze PROJ-7890
```

✅ **Good:**
```text
Analyze PROJ-7890 following core/rules/workflows.md.
First read 1-description.md, then search the codebase,
and update 2-analysis.md with findings (file:line).
```

### 2. Always refer to core/rules/

```text
Follow the workflows in core/rules/workflows.md
Follow the git rules in core/rules/git.md
Follow the testing rules in core/rules/testing.md
Follow the project's coding standards
```

### 3. Ask for step-by-step

```text
Do this step by step. Stop after each phase and ask for confirmation:
1. RED phase → Stop
2. GREEN phase → Stop
3. REFACTOR phase → Stop
```

### 4. Use checkpoint prompts

```text
Status check:
- Have you read core/rules/workflows.md?
- Have you followed the 4-file structure?
- Have you run the tests?
- Have you updated status.md?
```

### 5. Verify understanding

```text
Before you start: Summarize what you are going to do.
Include which files will be changed and which tests will be written.
```

---

## Limitations

### Permission prompts

Copilot CLI asks for permission for file operations and command execution.

**Solutions:**

```bash
# Approve everything for the session (interactive)
# Choose: "Yes, and approve all file operations for the rest of the running session"

# Or use CLI flags at startup
copilot --allow-all-tools                 # Allow all tools
copilot --allow-tool 'shell(git)'         # Allow specific tools
copilot --allow-all-paths                 # Allow all file paths

# Full automation (only in isolated environments)
copilot --yolo                            # Allow everything without prompts
```

**Permanent configuration:** Use `~/.copilot/config.json` with `trusted_folders` to pre-approve directories.

---

### Copilot CLI HAS:

- ✅ Native slash commands (`/model`, `/diff`, `/plugin install`, and more)
- ✅ Automatic reading of **CLAUDE.md** from the project root
- ✅ Automatic reading of `.github/copilot-instructions.md`
- ✅ Path-specific instructions (`.github/instructions/*.instructions.md`)
- ✅ Plan mode (Shift+Tab to switch modes)
- ✅ Autopilot mode (full autonomy without confirmations)
- ✅ Specialized agents (Explore, Task, Code Review, Plan)
- ✅ Agent Mode for autonomous multi-step tasks
- ✅ Codebase analysis
- ✅ Command execution
- ✅ Test iteration (RED → GREEN → REFACTOR)
- ✅ Tool calling (can run Python scripts)
- ✅ MCP server support (built-in GitHub MCP + custom)
- ✅ Permanent permissions via `config.json` and CLI flags

### Copilot CLI does NOT have:

- ❌ Built-in agents like `@agent-jira-analyzer` (uses general agents)

---

## Comparison with Claude Code

| Feature | Claude Code | Copilot CLI |
|---------|-------------|-------------|
| **Commands** | Slash commands (`/aide-create`) | Slash commands + natural language |
| **Instructions** | CLAUDE.md (auto-read) | CLAUDE.md + copilot-instructions.md |
| **Plan mode** | ✅ Native | ✅ Native (Shift+Tab) |
| **Autopilot mode** | ✅ (via permissions) | ✅ Native (`--yolo`) |
| **Agents** | `@agent-jira-analyzer` | Specialized (Explore, Task, Code Review) |
| **Skills** | ✅ `.claude/skills/` | ✅ Reads `~/.claude/commands/` + `.claude/skills/` |
| **TDD** | Built-in RED→GREEN→REFACTOR | Agent Mode iterates |
| **Codebase analysis** | ✅ | ✅ |
| **Tool calling** | ✅ | ✅ |
| **MCP servers** | ✅ | ✅ (built-in GitHub MCP) |
| **Permanent permissions** | ✅ `settings.json` | ✅ `config.json` + CLI flags |
| **Multi-step autonomy** | ✅ | ✅ |
| **Models** | Claude Opus/Sonnet/Haiku | Claude, GPT |
| **Context window** | 200K tokens | Varies by model |
| **IDE integration** | VS Code (via CLI) | VS Code (native) + CLI |

### Available models

| Model | Claude Code | Copilot CLI |
|--------|-------------|-------------|
| Claude Opus 4.7 | ✅ | ✅ |
| Claude Sonnet 4.6 | ✅ | ✅ |
| Claude Haiku 4.5 | ✅ | ✅ |
| GPT-5.5 | ❌ | ✅ |

### When to use what?

| Scenario | Recommendation |
|----------|-----------|
| **Complex JIRA analysis** | Claude Code (better skills/agents) |
| **Quick edits** | Copilot (faster in VS Code) |
| **TDD implementation** | Both work well |
| **Refactoring** | Copilot (native VS Code integration) |
| **Cross-cutting issues** | Claude Code (better multi-repo support) |
| **Full automation** | Copilot CLI (`--yolo` mode) |

---

## Next steps

1. ✅ Install Copilot and enable Agent Mode
2. ✅ Copy custom instructions
3. ✅ Test with a simple JIRA issue

---

## Headless Mode (Copilot CLI)

Copilot CLI supports headless mode for automation and scripting.

### Basic usage

```bash
# Run a single prompt without the interactive UI
copilot -p "Analyze this code"

# Allow all tools (for full automation)
copilot -p "Run all tests" --allow-all-tools

# Allow specific tools
copilot -p "Revert the last commit" --allow-tool 'shell(git)'

# Full automation (isolated environments)
copilot -p "Run all tests and fix failures" --yolo
```

### E2E Testing

```bash
# Test that Copilot CLI works
copilot -p "Say 'hello'"

# Run the aide workflow headless
copilot -p "/aide-create PROJ-TEST"
```

### Flag reference

| Flag | Description |
|-------|-------------|
| `-p "prompt"` | Headless/programmatic mode |
| `--allow-all-tools` | Allow all tools without confirmation |
| `--allow-tool 'tool'` | Allow a specific tool |
| `--deny-tool 'tool'` | Block a specific tool |
| `--allow-all-paths` | Allow access to all file paths |
| `--allow-all-urls` | Allow access to all URLs |
| `--allow-url <domain>` | Pre-approve a specific domain |
| `--yolo` / `--allow-all` | Allow everything without confirmation |

**Security:** Use `--yolo` / `--allow-all-tools` only in isolated environments (containers, VMs).

### Slash commands in the CLI

| Command | Description |
|----------|-------------|
| `/model` | Switch model mid-session |
| `/diff` | View all changes in the session with syntax highlighting |
| `/plugin install owner/repo` | Install plugins from GitHub |
| `/login` | Authentication |
| `/lsp` | Show LSP server status |
| `/feedback` | Send feedback |

---

## Resources

**Official documentation and best practices:**

- [GitHub Copilot Documentation](https://docs.github.com/en/copilot) - Complete documentation
- [Copilot Best Practices](https://docs.github.com/en/copilot/using-github-copilot/best-practices-for-using-github-copilot) - Official best practices
- [Prompt Engineering for Copilot](https://docs.github.com/en/copilot/using-github-copilot/prompt-engineering-for-github-copilot) - Prompt techniques

**Copilot CLI:**

- [Copilot CLI GitHub repo](https://github.com/github/copilot-cli) - Open source repo
- [Using Copilot CLI - GitHub Docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli) - CLI documentation
- [Configure Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli) - Configuration
- [Custom Instructions for CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions) - CLAUDE.md and instructions
- [GA announcement (Feb 25, 2026)](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/) - Changelog

---

**Good luck with GitHub Copilot!**
