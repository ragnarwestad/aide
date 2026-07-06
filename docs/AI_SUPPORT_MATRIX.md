# AI Support Matrix

Overview of which AI tools we support, which versions have been verified,
and which configuration files each tool reads.

**Update this document** when you upgrade a tool or discover new/changed config support.

## Table of contents

- [Supported versions](#supported-versions)
- [Current models](#current-models)
- [Cross-tool capabilities](#cross-tool-capabilities)
- [Open follow-up items](#open-follow-up-items)
- [Configuration overview](#configuration-overview)
- [Claude Code](#claude-code)
- [GitHub Copilot](#github-copilot)
- [Codex CLI](#codex-cli)
- [Gemini CLI](#gemini-cli)
- [Installation into target projects](#installation-into-target-projects)
- [See also](#see-also)

---

## Supported versions

| Tool | Version | Last verified | Status |
|---------|---------|-----------------|--------|
| Claude Code | 2.1.150 | 2026-05-23 | ✅ Supported |
| GitHub Copilot CLI | v1.0.51 | 2026-05-23 | ✅ Supported |
| Codex CLI | 0.133.0 | 2026-05-23 | ✅ Supported |
| Gemini CLI | 0.43.0 | 2026-05-23 | ✅ Supported |

Check installed versions:

```bash
claude --version
copilot --version
codex --version
gemini --version
```

---

## Current models

| Tool | Default / recommended model |
|---------|---------------------------|
| Claude Code | Claude Opus 4.7 (also Fast mode and Auto on Max) |
| GitHub Copilot CLI | `auto` (chooses itself); Claude and GPT-5.3-Codex available |
| OpenAI Codex CLI | GPT-5.5 (recommended); GPT-5.4 mini for fast subagent tasks |
| Gemini CLI | Gemini 3 (default); Gemini 3.5 Flash / 3.1 Flash-Lite for speed |

Release dates and history are in the [news log](./AI_NEWS_LOG.md).
Opus 4.7 has a known change: sampling parameters (`temperature` etc.) now return 400 errors.

## Cross-tool capabilities

All four tools have skills, stable hooks, subagents and a plan/analysis mode.

- **Claude Code:** native binary, `/ultrareview` (cloud-based code review), `/code-review`, `/goal`, plugins from `.zip`/URL, conditional/defer hooks, Windows without Git Bash
- **GitHub Copilot CLI:** BYOK + local models (`COPILOT_OFFLINE`), remote control of sessions, enterprise-managed plugins via a `.github-private` repo, `gh skill` for portable skills, `/security-review`, HTTP hooks
- **OpenAI Codex CLI:** stable hooks, `/goal` workflows as the default, `codex marketplace add`, `codex doctor`, Amazon Bedrock support
- **Gemini CLI:** subagents, `/memory inbox`, git worktree support, real-time voice mode, native sandboxing

## Open follow-up items

- ⚠️ **Copilot may no longer read project-level `.claude/*`.** The Copilot CLI stopped loading agents/skills/commands from `~/.claude/` (the personal directory is now `~/.agents/skills/`). Whether and how project-level `.claude/` cells are still read must be re-verified against the latest version — this affects the Copilot installation strategy.
- **The config cells in the tables below have not been hands-on re-verified** against the latest versions — items marked ⚠️ should be checked at the next update.
- The `effort` frontmatter on skills is in use (`low`/`medium`/`high`/`xhigh`) — Claude Code-specific.

---

## Configuration overview

Which files each tool reads automatically:

| File/directory | Claude Code | Copilot | Codex | Gemini |
|-----------|:-----------:|:-------:|:-----:|:------:|
| `CLAUDE.md` | ✅ primary | ✅ read | ✅ read | — |
| `AGENTS.md` | — | ✅ read | ✅ primary | — |
| `GEMINI.md` | — | ✅ read | — | ✅ primary |
| `.claude/rules/*.md` | ✅ auto-include | ✅ read | — | — |
| `.claude/skills/` | ✅ native skills | ✅ read | — | — |
| `.github/skills/` | — | ✅ native skills | — | — |
| `~/.copilot/skills/` | — | ✅ global skills | — | — |
| `.claude/commands/*.md` | ✅ slash commands | ✅ read | — | — |
| `.claude/agents/*.md` | ✅ agents | ✅ read | — | — |
| `.claude/settings.json` | ✅ MCP + hooks | — | — | — |
| `.github/copilot-instructions.md` | — | ✅ primary | — | — |
| `.github/instructions/**/*.instructions.md` | — | ✅ path-specific | — | — |
| `~/.copilot/copilot-instructions.md` | — | ✅ global | — | — |
| `~/.codex/AGENTS.md` | — | — | ✅ global | — |
| `~/.codex/config.toml` | — | — | ✅ MCP | — |
| `.gemini/commands/*.toml` | — | — | — | ✅ slash commands |
| `~/.gemini/settings.json` | — | — | — | ✅ MCP |
| `.vscode/tasks.json` | — | ✅ tasks | — | — |

> ⚠️ **The Copilot `.claude/*` rows need re-verification.** The Copilot CLI stopped
> loading agents/skills/commands from `~/.claude/`. Whether and how project-level `.claude/`
> is still read has not been confirmed — see [Open follow-up items](#open-follow-up-items).

---

## Claude Code

**Version:** 2.1.150 | **Last verified:** 2026-05-23

### Instruction files (read automatically)

| File | Description |
|-----|-------------|
| `CLAUDE.md` | Primary instruction file — read at startup |
| `~/.claude/CLAUDE.md` | Global instruction file (user level) |
| `.claude/rules/*.md` | Rule files — **automatically included** in context |

### Configuration

| File | Description |
|-----|-------------|
| `.claude/settings.json` | MCP servers, hooks, permissions |
| `.claude/skills/*/SKILL.md` | Native skills (activated by Claude automatically) |
| `.claude/commands/*.md` | Slash commands (`/command`) |
| `.claude/agents/*.md` | Custom agents (can be called with the Agent tool) |

### Features

- **Skills:** Activated automatically based on the context of the request
- **Slash commands:** The user types `/command`, Claude executes it
- **Agents:** Specialized sub-agents for parallel tasks
- **MCP:** Support for MCP servers via `settings.json`
- **Hooks:** Pre/post hooks for tool calls via `settings.json`
- **Auto-apply edits:** Can be configured to write files without confirmation

### Implementation

```text
implementations/claude-code/
├── INSTALL.md
├── setup.sh
└── config/project/.claude/     ← copied to the target project
```

---

## GitHub Copilot

**Version:** Copilot CLI v1.0.51 | **Last verified:** 2026-05-23

### Instruction files (read automatically)

| File | Description |
|-----|-------------|
| `.github/copilot-instructions.md` | Repository-wide instructions — primary |
| `.github/instructions/**/*.instructions.md` | Path-specific instructions |
| `~/.copilot/copilot-instructions.md` | Global user instructions |
| `CLAUDE.md` | Also read (compatibility with Claude Code) |
| `AGENTS.md` | Also read |
| `GEMINI.md` | Also read |

**Important:** Copilot additionally reads the `.claude/` structure:

> ⚠️ **Needs re-verification.** The Copilot CLI stopped loading agents/skills/commands
> from `~/.claude/`. The Copilot strategy below — and the "CRITICAL" block further down — assumes that Copilot reads
> `.claude/`. Confirm against Copilot CLI v1.0.51 before the next install. See [Open follow-up items](#open-follow-up-items).

| File | Description |
|-----|-------------|
| `.claude/skills/` | Agent skills — read automatically (same format as Claude Code) |
| `.claude/commands/*.md` | Slash commands — read by the Copilot CLI |
| `.claude/agents/*.md` | Custom agents — read by the Copilot CLI |
| `.claude/rules/*.md` | Rule files — read by the Copilot CLI |

**Skills (native Copilot locations):**

| File | Description |
|-----|-------------|
| `.github/skills/*/SKILL.md` | Repo-specific skills (Copilot's native location) |
| `~/.copilot/skills/*/SKILL.md` | Global skills (shared across projects) |

Since we already have skills in `.claude/skills/`, Copilot picks them up automatically — we do not need to duplicate them to `.github/skills/`.

### Configuration

| File | Description |
|-----|-------------|
| `.vscode/tasks.json` | VS Code tasks (available via the Command Palette) |

### Features

- **Slash commands** — reads shared skills from `~/.claude/skills/` (e.g. `/aide-create`)
- **VS Code tasks** — predefined tasks in the Command Palette
- **Agent Mode** — can execute multi-step workflows autonomously
- **MCP:** Support via the GitHub MCP server

### Installation into target projects

`install.sh` installs globally — `AGENTS.md` becomes `~/.copilot/copilot-instructions.md`,
and the shared scripts end up in `~/.local/bin/`. Skills are shared via `~/.claude/skills/`, which
Copilot reads automatically. The projects therefore need no Copilot config of their own.

### Implementation

```text
implementations/copilot/
├── install.sh / uninstall.sh ← installs core/AGENTS.md → ~/.copilot/copilot-instructions.md
├── .vscode/tasks.json        ← VS Code tasks
└── jetbrains/                ← JetBrains live templates

(The instruction file is generated to core/AGENTS.md by core/scripts/build-agents-md.sh)
```

---

## Codex CLI

**Version:** 0.133.0 | **Last verified:** 2026-05-23

### Instruction files (read automatically)

| File | Description |
|-----|-------------|
| `AGENTS.md` (`~/.codex/AGENTS.md`) | Primary instruction file (installed from `core/AGENTS.md`) |
| `CLAUDE.md` | Also read |

### Configuration

| File | Description |
|-----|-------------|
| `~/.codex/config.toml` | Global config: execPolicy, MCP servers |

### Features

- **No native slash commands** — uses `codex-aide-*` wrappers
- **CLI wrappers** in `scripts/codex-aide-*` for common workflows
- **MCP:** Support via `~/.codex/config.toml`
- **Parallel execution** — can work on several tasks at once

### Implementation

```text
implementations/codex/
├── config.toml                 ← sandbox + MCP
├── install.sh / uninstall.sh   ← global install: ~/.codex/AGENTS.md + wrappers
└── scripts/codex-aide-*        ← CLI wrappers
```

---

## Gemini CLI

**Version:** 0.43.0 | **Last verified:** 2026-05-23

### Instruction files (read automatically)

| File | Description |
|-----|-------------|
| `GEMINI.md` (`~/.gemini/GEMINI.md`) | Primary instruction file (installed from `core/AGENTS.md`) |

### Configuration

| File | Description |
|-----|-------------|
| `~/.gemini/commands/*.toml` | Slash commands (TOML format) |
| `~/.gemini/settings.json` | Global config: MCP servers, theme |

### Features

- **Slash commands** via `.toml` files (similar to Claude Code, but TOML format)
- **1M token context window** — largest of all the tools
- **Google Search grounding** — can search the web
- **MCP:** Support via `~/.gemini/settings.json`
- **Generous free quota:** 60 req/min, 1000 req/day

### Implementation

```text
implementations/gemini/
├── install.sh / uninstall.sh   ← global install: ~/.gemini/GEMINI.md + commands
├── settings.json               ← Gemini config (MCP)
├── .gemini/commands/*.toml     ← slash commands
└── mcp/                        ← MCP setup docs
```

(GEMINI.md comes from core/AGENTS.md — install.sh copies it to ~/.gemini/GEMINI.md)

---

## Installation into target projects

When you install doc-aide into a target project (e.g. my-app):

### Minimum requirements per tool

| Tool | Required files |
|---------|----------------|
| Claude Code | `.claude/` (commands, rules, agents, skills), `CLAUDE.md` |
| Copilot | `.github/copilot-instructions.md` **and** `.claude/` (commands, rules, agents) |
| Codex | `~/.codex/AGENTS.md` (from `core/AGENTS.md`) |
| Gemini | `GEMINI.md`, `.gemini/commands/` |

### Automated installation

```bash
# Claude Code
implementations/claude-code/setup.sh

# Copilot
implementations/copilot/install.sh

# Codex
implementations/codex/install.sh (if present)

# Gemini
implementations/gemini/install.sh (if present)
```

---

## Official sources

Check these when you update versions or wonder whether something has changed:

### Claude Code

- [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code/overview)
- [Claude Code settings (CLAUDE.md, rules, skills, MCP)](https://docs.anthropic.com/en/docs/claude-code/settings)
- [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills)

### GitHub Copilot

- [Custom instructions — all supported file types](https://docs.github.com/en/copilot/reference/custom-instructions-support)
- [Repository instructions (.github/copilot-instructions.md)](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)
- [Agent skills (.github/skills/, .claude/skills/)](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills)
- [Changelog: Copilot supports agent skills (2025-12-18)](https://github.blog/changelog/2025-12-18-github-copilot-now-supports-agent-skills/)

### Codex CLI

- [Codex CLI — GitHub repo and README](https://github.com/openai/codex)

### Gemini CLI

- [Gemini CLI — GitHub repo and README](https://github.com/google-gemini/gemini-cli)

---

## See also

- [AI_NEWS_LOG.md](./AI_NEWS_LOG.md) — News log / research feed that feeds this matrix
- [AI_DEVELOPMENT_GUIDE.md](./AI_DEVELOPMENT_GUIDE.md) — Architecture and design patterns
- [implementations/claude-code/](../implementations/claude-code/) — Claude Code implementation
- [implementations/copilot/](../implementations/copilot/) — Copilot implementation
- [implementations/codex/](../implementations/codex/) — Codex implementation
- [implementations/gemini/](../implementations/gemini/) — Gemini implementation
