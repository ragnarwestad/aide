# OpenAI Codex - Implementation Guide

## Table of Contents

- [Overview](#overview)
- [What is OpenAI Codex?](#what-is-openai-codex)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
  - [MCP servers](#mcp-servers-model-context-protocol)
  - [Rules](#rules-command-control)
  - [AGENTS.md](#agentsmd-persistent-instructions)
  - [Hooks](#hooks)
- [Usage](#usage)
  - [The spec workflow](#the-spec-workflow)
  - [TDD workflow](#tdd-workflow)
- [Slash commands](#slash-commands)
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
├── hooks/                              # hooks.json + scripts → ~/.codex/
└── install.sh / uninstall.sh           # Global install: AGENTS.md, hooks, skills
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
- Whichever model the installed Codex CLI ships as its default — see [docs/AI_SUPPORT_MATRIX.md](../../docs/AI_SUPPORT_MATRIX.md)

---

## Prerequisites

### 1. OpenAI subscription
- ChatGPT Plus, Pro, Business, or Enterprise — the CLI signs in with it (`codex login`)

### 2. Codex CLI
```bash
# Install the Codex CLI
npm install -g @openai/codex

# Or through mise, which is what upgrade-ai-tools keeps current
mise use -g npm:@openai/codex
```

---

## Installation

### Step 1: Install and authenticate Codex

```bash
# Install the CLI
npm install -g @openai/codex

# Sign in with your ChatGPT account
codex login

# Verify the installation
codex --version
```

### Step 2: Install the instruction file (AGENTS.md)

Run the installer:

```bash
aide/implementations/codex/install.sh
```

It copies `core/AGENTS.md` (generated from `core/rules/`) to `~/.codex/AGENTS.md`, installs the hooks
(`~/.codex/hooks.json` and `~/.codex/hooks/aide-*.sh`, which need `jq`), every skill in `core/skills/` to
`~/.agents/skills/`, and the shared scripts to `~/.local/bin/`.

Codex reads `~/.codex/AGENTS.md` automatically at startup (as well as the repo `AGENTS.md` via directory walk).

---

## Configuration

### Instructions (AGENTS.md)

Codex automatically reads `~/.codex/AGENTS.md` (installed from `core/AGENTS.md`), which contains:

- 🎯 The workspace concept and structure
- 🧪 TDD rules from `core/rules/testing.md`
- 🔀 Git rules from `core/rules/git.md`
- 🗣️ Communication rules from `core/rules/communication.md`
- 🧠 Coding discipline from `core/rules/llm-discipline.md`

Only the rules that apply to every turn are in this file. The
task-specific guidance — workflows, the documentation standard, markdown
linting, tools and scripts, and the 4-file spec structure — are skills in
`~/.agents/skills/`, read when they are relevant instead. Codex appends
at most `project_doc_max_bytes` of AGENTS.md, 32768 by default, and drops
the rest without saying so, so the file is kept well inside that budget
(spec 147).

### MCP servers (Model Context Protocol)

Codex supports MCP servers for extended functionality. Each server is a `[mcp_servers.<name>]` table in
`~/.codex/config.toml`:

```toml
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
```

`install.sh` offers two sets, and appends the matching file from `mcp/` when you say yes:

- `mcp/browser-testing.toml` — Playwright and Chrome DevTools (see `mcp/BROWSER_TESTING_MCP_SETUP.md`)
- `mcp/context7.toml` — Context7 (see `mcp/CONTEXT7_MCP_SETUP.md`)

### Rules (command control)

Codex decides which commands may run outside the sandbox from rule files in `~/.codex/rules/*.rules`.
Each rule is a `prefix_rule` that matches the start of a command:

```text
prefix_rule(pattern=["git", "status"], decision="allow")
prefix_rule(pattern=["git", "push", "--force"], decision="forbidden")
prefix_rule(pattern=["curl"], decision="prompt")
```

`decision` is `allow` (run without asking), `prompt` (ask first) or `forbidden` (never run). When you
approve a command for good during a session, Codex appends a rule to `~/.codex/rules/default.rules`.

### AGENTS.md (persistent instructions)

Codex's instruction file is `AGENTS.md`. Aide generates `core/AGENTS.md` from `core/rules/`, and `install.sh` installs it as `~/.codex/AGENTS.md`. Codex additionally reads an `AGENTS.md` in the project root via directory walk (git root → cwd), so projects can add their own rules:

```markdown
# AGENTS.md

## Project rules
- Follow the TDD workflow (RED → GREEN → REFACTOR)
- Use Norwegian in commit messages
- Always run the tests before considering a task done
```

### Hooks

`install.sh` installs `hooks/hooks.json` to `~/.codex/hooks.json` and the
`hooks/aide-*.sh` scripts to `~/.codex/hooks/`. They port the four Claude Code
hooks from `implementations/claude-code/settings.json`:

| Hook                                        | Event              | What it does                                                  |
|---------------------------------------------|--------------------|---------------------------------------------------------------|
| `aide-markdownlint.sh`                      | PostToolUse        | Lints markdown files right after they are edited              |
| `aide-block-git-add-all.sh`                 | PreToolUse         | Blocks `git add .` / `git add -A` (explicit file names only)  |
| `aide-block-watch-mode.sh`                  | PreToolUse         | Blocks `pnpm test` without `--run` (watch mode never exits)   |
| `aide-track-turn.sh` + `aide-stop-guard.sh` | PostToolUse + Stop | Refuses to end a turn where source code changed without tests |

The Stop guard works differently from Claude Code's: Codex has no prompt
hooks, so `aide-track-turn.sh` writes per-turn markers ("code changed",
"tests run") under `$TMPDIR`, and `aide-stop-guard.sh` blocks Stop when the
first exists without the second. The scripts require `jq`.

All four hooks are verified in live `codex exec` sessions (0.147.0,
2026-08-13): the Stop guard blocked a turn that changed source code without
tests, the markdownlint hook linted a file created via `apply_patch` (the
path extraction from the patch text works), and `git add .` was denied with
the hook's message.

**Hook trust:** Codex only runs hooks it trusts. The first interactive
session after installing asks you to approve them once; headless automation
(`codex exec`) must pass `--dangerously-bypass-hook-trust` until that
approval exists. Note that repo-level `.codex/hooks.json` did not load in
`codex exec` during verification — Aide's hooks are global
(`~/.codex/hooks.json`), so this does not affect them.

---

## Usage

### The spec workflow

#### 1. Create the spec

**Instead of:** `/aide-create "<title>" <description>` (Claude Code)

**With Codex:**

```bash
# Interactive session
codex

# Or as a direct command
codex "Create a spec titled 'Move the forms off Redux Form' with this description: ...

1. Run aide-create-spec (never write the files by hand)
2. It creates specs/<NN>-slug/ with 1-description.md filled in
   and 2-analysis.md, 3-solution.md, 4-status.md ready
3. Stage all new files in git"
```

#### 2. Analyze the codebase

**Instead of:** `/aide-analyze PROJ-7890` (Claude Code)

**With Codex:**

```bash
codex "Analyze the codebase for spec 55:

1. Read specs/55-slug/1-description.md
2. Search the codebase for relevant files
3. Identify affected components (file:line)
4. Check API impact (frontend ↔ backend)
5. Assess complexity (simple/medium/complex)
6. Update 2-analysis.md with findings
7. Create an implementation plan in 3-solution.md
8. Follow the core/skills/workflows/SKILL.md structure"
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

## Slash commands

Codex reads skills from `~/.agents/skills/`. `install.sh` copies every skill
in `core/skills/` there, so the Aide workflows (`/aide-create`,
`/aide-analyze`, …) are available as skills in a `codex` session.

---

## Tips and tricks

### 1. Be explicit about context

❌ **Bad:**
```bash
codex "Analyze PROJ-7890"
```

✅ **Good:**
```bash
codex "Analyze PROJ-7890 by following core/skills/workflows/SKILL.md.
First read 1-description.md, then search the codebase,
and update 2-analysis.md with findings (file:line)."
```

### 2. Always reference core/rules/

```bash
codex "Follow the workflows in core/skills/workflows/SKILL.md
Follow the git rules in core/rules/git.md
Follow the testing rules in core/rules/testing.md
Follow the project's coding standards"
```

---

## Limitations

### Codex does NOT have:
- ❌ Automatic reading of CLAUDE.md at startup (use `AGENTS.md`)
- ❌ Built-in agents like `@agent-task-analyzer`
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
1. **Auto-read CLAUDE.md → AGENTS.md:** Use `AGENTS.md` (installed globally as `~/.codex/AGENTS.md`)
2. **Agents → Explicit prompts:** Ask Codex to follow specific workflows
3. **Free → Paid:** Requires a subscription

---

## Comparison with Claude Code

What each tool supports, verified against installed versions, is kept in one place:
[docs/AI_SUPPORT_MATRIX.md](../../docs/AI_SUPPORT_MATRIX.md).

---

## Next steps

1. ✅ Install the Codex CLI
2. ✅ Sign in with `codex login`
3. ✅ Copy the custom instructions
4. ✅ Test with a simple spec

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
codex exec "Run all tests" --json
```

### E2E testing

```bash
# Test that the Codex CLI works
codex exec "Say 'hello'"

# Run an aide workflow headless
codex exec '/aide-create "A test spec" Just checking that the flow works.'
```

### Flags for automation

| Flag                           | Description                                    |
|--------------------------------|------------------------------------------------|
| `exec "prompt"`                | Headless mode - run without the interactive UI |
| `--output-last-message <file>` | Write the last message to a file               |
| `--json`                       | JSONL output for parsing                       |

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
