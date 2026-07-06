# OpenAI Codex - Implementation Guide

## Table of Contents

- [Overview](#overview)
- [What is OpenAI Codex?](#what-is-openai-codex)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
  - [CLI wrappers](#step-3-install-the-cli-wrappers-recommended)
- [Configuration](#configuration)
  - [MCP servers](#mcp-servers-model-context-protocol)
  - [Execpolicy](#execpolicy-command-control)
  - [AGENTS.md](#agentsmd-persistent-instructions)
- [Usage](#usage)
  - [JIRA workflow](#jira-workflow)
  - [TDD workflow](#tdd-workflow)
- [Slash commands and wrappers](#slash-commands-and-wrappers)
- [Tips and tricks](#tips-and-tricks)
- [Limitations](#limitations)
- [Comparison with Claude Code](#comparison-with-claude-code)

---

## Overview

This implementation lets you use the **OpenAI Codex CLI** to follow the same workflows as Claude Code, with terminal-based AI assistance.

**Architecture:**
```text
implementations/codex/
├── README.md                           # This file
├── config.toml                         # Codex config (sandbox, MCP)
├── install.sh / uninstall.sh           # Global install: ~/.codex/AGENTS.md + CLI wrappers
└── scripts/
    ├── codex-aide-create              # CLI wrapper for aide-create
    ├── codex-aide-analyze             # CLI wrapper for aide-analyze
    └── codex-aide-implement                  # CLI wrapper for aide-implement
```

**Reuses:**
- ✅ `core/rules/` - Same workflows, git rules, testing rules
- ✅ `core/templates/` - Same 4-file document structure
- ✅ `core/scripts/` - Same scripts (aide-generate-pdf, etc.)

---

## What is OpenAI Codex?

**OpenAI Codex** is an AI coding agent from OpenAI that can:
- ✅ Run locally in the terminal with access to the file system
- ✅ Work on many tasks in parallel
- ✅ Navigate the repo, edit files, run commands
- ✅ Integrate with GitHub, Slack, IDEs
- ✅ Build entire projects from scratch
- ✅ Perform large refactorings

**Difference from GitHub Copilot:**
- GitHub Copilot: IDE-based, code completion and chat
- OpenAI Codex: Terminal-based agent, autonomous multi-step tasks

**Model:**
- Powered by GPT-5-Codex (optimized for software engineering)

---

## Prerequisites

### 1. OpenAI subscription
- ChatGPT Plus, Pro, Business, or Enterprise
- API access (for the CLI)

### 2. Codex CLI
```bash
# Install the Codex CLI
npm install -g @openai/codex-cli

# Or via Homebrew (macOS)
brew install openai/tap/codex
```

### 3. IntelliJ plugin (optional)
```text
# Install "Codex Launcher" from the JetBrains Marketplace
# https://plugins.jetbrains.com/plugin/28264-codex-launcher
```

---

## Installation

### Step 1: Install and authenticate Codex

```bash
# Install the CLI
npm install -g @openai/codex-cli

# Authenticate with your OpenAI API key
codex auth

# Verify the installation
codex --version
```

### Step 2: Install the instruction file (AGENTS.md)

The instructions live in `core/AGENTS.md` (generated from `core/rules/`). `install.sh` copies it to `~/.codex/AGENTS.md`:

```bash
cp core/AGENTS.md ~/.codex/AGENTS.md
```

Codex reads `~/.codex/AGENTS.md` automatically at startup (as well as the repo `AGENTS.md` via directory walk).

### Step 3: Install the CLI wrappers (recommended)

The CLI wrappers make it easy to start aide workflows without manually copying prompts:

```bash
# Copy the CLI wrappers to PATH
cp implementations/codex/scripts/codex-aide-* ~/.local/bin/
chmod +x ~/.local/bin/codex-aide-*
```

**Available commands:**

| Command | Description |
|----------|-------------|
| `codex-aide-create <ID>` | Create the document structure for a JIRA issue or TODO |
| `codex-aide-analyze <ID>` | Analyze the codebase and identify affected files |
| `codex-aide-implement <ID>` | Implement the solution with TDD |

**Examples:**

```bash
# JIRA workflow
codex-aide-create PROJ-7890
codex-aide-analyze PROJ-7890
codex-aide-implement PROJ-7890

# TODO workflow
codex-aide-create todo-01-redux-migration
codex-aide-analyze todo-01
codex-aide-implement todo-01
```

---

## Configuration

### Instructions (AGENTS.md)

Codex automatically reads `~/.codex/AGENTS.md` (installed from `core/AGENTS.md`), which contains:

- 🎯 The workspace concept and structure
- 📋 References to `core/rules/workflows.md`
- 🧪 TDD rules from `core/rules/testing.md`
- 🔀 Git rules from `core/rules/git.md`
- 📝 Documentation standard from `core/rules/documentation.md`

### Environment variables

```bash
# Add to ~/.bashrc or ~/.zshrc
export OPENAI_API_KEY="your-api-key-here"
export CODEX_MODEL="gpt-5-codex"  # Or o4-mini for faster/cheaper
```

### MCP servers (Model Context Protocol)

Codex supports MCP servers for extended functionality. Configure them in `~/.codex/config.toml`:

```toml
[mcp]
# Example: Filesystem MCP server
[[mcp.servers]]
name = "filesystem"
command = "npx"
args = ["-y", "@anthropic/mcp-filesystem", "/path/to/allowed/dir"]

# Example: GitHub MCP server
[[mcp.servers]]
name = "github"
command = "npx"
args = ["-y", "@anthropic/mcp-github"]
env = { GITHUB_TOKEN = "your-token" }
```

**Available MCP servers:**

- `@anthropic/mcp-filesystem` - File system access
- `@anthropic/mcp-github` - GitHub integration
- `@anthropic/mcp-slack` - Slack integration
- Custom servers via the MCP protocol

### Execpolicy (command control)

Define rules for which commands Codex may run in `~/.codex/config.toml`:

```toml
[execpolicy]
# Approved commands (run without confirmation)
allow = [
  "pnpm *",
  "npm *",
  "npx *",
  "git status",
  "git diff *",
  "git log *"
]

# Blocked commands (cannot be run)
deny = [
  "rm -rf *",
  "git push --force *",
  "git commit *"  # Block commits, as in Claude Code
]

# Require confirmation (default for unknown commands)
confirm = [
  "git add *",
  "curl *",
  "wget *"
]
```

### AGENTS.md (persistent instructions)

Codex's instruction file is `AGENTS.md`. doc-aide generates `core/AGENTS.md` from `core/rules/`, and `install.sh` installs it as `~/.codex/AGENTS.md`. Codex additionally reads an `AGENTS.md` in the project root via directory walk (git root → cwd), so projects can add their own rules:

```markdown
# AGENTS.md

## Project rules
- Follow the TDD workflow (RED → GREEN → REFACTOR)
- Use Norwegian in commit messages
- Always run the tests before considering a task done
```

---

## Usage

### JIRA workflow

#### 1. Create JIRA documentation

**Instead of:** `/aide-create PROJ-7890` (Claude Code)

**With Codex:**

```bash
# Interactive session
codex

# Or as a direct command
codex "Create structured documentation for JIRA issue PROJ-7890:

1. Create directory: reports/<NN>-PROJ-7890-slug/
2. Follow core/rules/documentation.md
3. Use templates from core/templates/todo/
4. Fill in 1-description.md with JIRA metadata (user pastes in the data)
5. Create empty files: 2-analysis.md, 3-solution.md, 4-status.md
6. Stage all new files in git"
```

**Or use the CLI wrapper:**
```bash
codex-aide-create PROJ-7890
```

#### 2. Analyze the codebase

**Instead of:** `/aide-analyze PROJ-7890` (Claude Code)

**With Codex:**

```bash
codex "Analyze the codebase for JIRA issue PROJ-7890:

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

**With Codex:**

```bash
codex "Implement the solution for PROJ-7890 with TDD:

RED PHASE:
1. Read 3-solution.md → Step 0: Write tests
2. Create the test files as described
3. Run: pnpm test -- --run <testfile>
4. Verify that the tests FAIL
5. Stop and ask for confirmation

GREEN PHASE:
1. Implement Steps 1-N from 3-solution.md
2. Run the tests after each step
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

Codex supports the TDD cycle:
- Writes tests first (RED)
- Implements until tests pass (GREEN)
- Refactors and verifies (REFACTOR)
- Iterates automatically on failures

---

## Slash commands and wrappers

Codex reads the same skills as Claude Code (from `~/.agents/skills/`), and there
are CLI wrappers for the most common workflows:

| Wrapper | Purpose | Claude Code equivalent |
|---------|--------|----------------------|
| `codex-aide-create` | Create JIRA/TODO documentation | `/aide-create` |
| `codex-aide-analyze` | Analyze the codebase | `/aide-analyze` |
| `codex-aide-implement` | Implement with TDD | `/aide-implement` |

**Usage:**
```bash
codex-aide-create PROJ-7890
```

---

## Tips and tricks

### 1. Be explicit about context

❌ **Bad:**
```bash
codex "Analyze PROJ-7890"
```

✅ **Good:**
```bash
codex "Analyze PROJ-7890 by following core/rules/workflows.md.
First read 1-description.md, then search the codebase,
and update 2-analysis.md with findings (file:line)."
```

### 2. Always reference core/rules/

```bash
codex "Follow the workflows in core/rules/workflows.md
Follow the git rules in core/rules/git.md
Follow the testing rules in core/rules/testing.md
Follow the project's coding standards"
```

### 3. Use parallel tasks

Codex can work on several tasks at the same time:

```bash
# Start a background task
codex --background "Analyze all components in src/components/"

# Continue with other work
codex "Implement a new feature in UserProfile"
```

### 4. Integrate with GitHub

```bash
# Preload repository
codex --github myorg/my-app

# Work on a PR
codex "Review PR #123 and check whether it follows KODESTANDARD.md"
```

### 5. Use the IntelliJ plugin

1. Install "Codex Launcher" from the Marketplace
2. Right-click in the editor → "Open with Codex"
3. Codex opens with file context

---

## Limitations

### Codex does NOT have:
- ❌ Native slash commands (uses natural language instead)
- ❌ Automatic reading of CLAUDE.md at startup (use `AGENTS.md`)
- ❌ Built-in agents like `@agent-jira-analyzer`
- ❌ A free tier (requires Plus/Pro/Enterprise)

### Codex DOES have:
- ✅ Terminal-based CLI
- ✅ Parallel tasks
- ✅ GitHub/Slack/IDE integration
- ✅ Instruction file (`AGENTS.md` → `~/.codex/AGENTS.md`)
- ✅ Codebase analysis
- ✅ Command execution
- ✅ Auto-iteration on failures

### Costs:
- API: $1.50/1M input tokens, $6/1M output tokens
- Subscription: ChatGPT Plus/Pro/Business/Enterprise
- Rate limits (extra credits can be purchased)

### Workarounds:
1. **Slash commands:** Use skills (`~/.agents/skills/`) or the `codex-aide-*` wrappers
2. **Auto-read CLAUDE.md → AGENTS.md:** Use `AGENTS.md` (installed globally as `~/.codex/AGENTS.md`)
3. **Agents → Explicit prompts:** Ask Codex to follow specific workflows
4. **Free → Paid:** Requires a subscription

---

## Comparison with Claude Code

| Feature | Claude Code | OpenAI Codex |
|---------|-------------|--------------|
| **Commands** | Slash commands (`/aide-create`) | Natural language prompts |
| **Instructions** | CLAUDE.md (auto-read) | AGENTS.md (~/.codex/AGENTS.md) |
| **Agents** | `@agent-jira-analyzer` | General agent |
| **TDD** | Built-in RED→GREEN→REFACTOR | Supports the TDD cycle |
| **Codebase analysis** | ✅ | ✅ |
| **Tool calling** | ✅ | ✅ |
| **Parallel tasks** | ❌ | ✅ |
| **GitHub integration** | Via gh CLI | Native |
| **Slack integration** | ❌ | ✅ |
| **Context window** | 200K tokens | Varies (GPT-5) |
| **IDE integration** | VS Code (via CLI) | IntelliJ, VS Code, Cursor |
| **Price** | Free (beta) | $1.50-$6/1M tokens |

### When to use what?

| Scenario | Recommendation |
|----------|-----------|
| **Complex JIRA analysis** | Claude Code (larger context, free) |
| **Parallel tasks** | Codex (native support) |
| **TDD implementation** | Both work well |
| **GitHub workflows** | Codex (native integration) |
| **Team collaboration** | Codex (Slack integration) |
| **Cost-conscious** | Claude Code (free in beta) |

---

## Next steps

1. ✅ Install the Codex CLI
2. ✅ Authenticate with your OpenAI API key
3. ✅ Copy the custom instructions
4. ✅ Test with a simple JIRA issue
5. ✅ Read [docs/AI_ASSISTERT_UTVIKLING.md](../../docs/AI_ASSISTERT_UTVIKLING.md) for the full documentation

---

## Headless Mode (automation)

The Codex CLI supports headless mode via `codex exec` for automation, CI/CD and scripting.

### Basic usage

```bash
# Run a single prompt without the interactive UI
codex exec "Analyze this code and suggest improvements"

# Output the last message to a file
codex exec "List all TypeScript files" --output-last-message result.txt

# JSONL output for programmatic parsing
codex exec "Run all tests" --format jsonl
```

### E2E testing

```bash
# Test that the Codex CLI works
codex exec "Say 'hello'"

# Run an aide workflow headless
codex exec "/aide-create PROJ-TEST"
```

### Flags for automation

| Flag | Description |
|-------|-------------|
| `exec "prompt"` | Headless mode - run without the interactive UI |
| `--output-last-message <file>` | Write the last message to a file |
| `--format jsonl` | JSONL output for parsing |

**Note:** Authentication can be challenging in headless environments (requires an OAuth flow).

---

## Resources

**Official documentation and best practices:**

- [OpenAI API Documentation](https://platform.openai.com/docs) - Complete API documentation
- [OpenAI Best Practices](https://platform.openai.com/docs/guides/best-practices) - Official best practices
- [OpenAI Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering) - Prompt techniques

**Headless mode and CLI:**

- [Codex CLI - OpenAI Developers](https://developers.openai.com/codex/cli) - CLI documentation
- [Codex GitHub](https://github.com/openai/codex) - Open source repo

---

**Good luck with OpenAI Codex!**
