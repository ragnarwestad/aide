# AI Support Matrix

Overview of which AI tools we support, which versions have been verified,
and which configuration files each tool reads.

**Update this document** when you upgrade a tool or discover new/changed config support.

## Table of contents

- [Supported versions](#supported-versions)
- [Fidelity levels](#fidelity-levels)
- [How the aide pieces land](#how-the-aide-pieces-land)
- [Current models](#current-models)
- [Cross-tool capabilities](#cross-tool-capabilities)
- [Open follow-up items](#open-follow-up-items)
- [Configuration overview](#configuration-overview)
- [Claude Code](#claude-code)
- [GitHub Copilot](#github-copilot)
- [Codex CLI](#codex-cli)
- [Installation into target projects](#installation-into-target-projects)
- [See also](#see-also)

---

## Supported versions

| Tool | Version | Last verified | Status |
|---------|---------|-----------------|--------|
| Claude Code | 2.1.231 | 2026-08-13 | ✅ Supported |
| GitHub Copilot CLI | 1.0.79 | 2026-08-13 | ✅ Supported |
| Codex CLI | 0.147.0 | 2026-08-13 | ✅ Supported |

**The Version and Last verified columns are stamped from probing — do not
edit them by hand.** Run:

```bash
scripts/stamp-versions
```

It asks each CLI (`claude --version` etc.) and writes what the tool
actually reports; a tool that is not on PATH keeps its old row.

---

## Fidelity levels

Yes/no hides the difference that matters: WHO guarantees that a piece is
followed. Every cell in the next table carries one of these grades:

| Grade | Meaning | Guaranteed by |
|-------|---------|---------------|
| **E — Enforced** | The tool mechanically enforces it (a hook blocks, config is applied) | The tool |
| **H — Heuristic** | A tool feature usually triggers it (skill activation on description match) | The tool, best-effort |
| **I — Instruction** | Plain text the model usually follows — nothing checks it | The model |
| **—** | Does not land in this tool at all | Nobody |

An **I** is not worthless — most of aide IS instructions — but an I that
everyone believed was an E is how rules break silently.

---

## How the aide pieces land

| aide piece | Claude Code | Copilot | Codex |
|-----------|-------------|---------|-------|
| Rules (git, testing, workflows, …) | **E** — auto-loaded from `~/.claude/rules/` | **I** — text in `~/.copilot/copilot-instructions.md` | **I** — text in `~/.codex/AGENTS.md` |
| Skills (`/aide-create`, `/aide-explore`, …) | **H** — native, activated on description match | **H** — read from `~/.agents/skills/` | **H** — read from `~/.agents/skills/` |
| Hooks (markdownlint, `git add .` block, watch-mode block, Stop) | **E** — enforced via `settings.json` | **—** | **E** — via `~/.codex/hooks.json` (verified live against 0.147.0; needs one-time hook trust) |
| Agents (task-analyzer) | **H** — invoked via the Agent tool | **—** | **—** |
| Report workflow (explore → create → … → archive) | **H** — the skills carry it | **H** — the skills carry it | **H** — the skills carry it |

Verified hands-on against Copilot CLI 1.0.79 (`copilot skill list`,
2026-08-13): personal skills are read from `~/.agents/skills/` — **not**
`~/.claude/skills/` anymore (a probe skill placed only there was not listed).
Project-level `.claude/skills/` is still read. The copilot and codex
installers both install `core/skills/` to `~/.agents/skills/` via
`core/scripts/_install-skills.sh`; each skill is listed once, no duplication.

---

## Current models

| Tool | Default / recommended model |
|---------|---------------------------|
| Claude Code | Claude Opus 4.7 (also Fast mode and Auto on Max) |
| GitHub Copilot CLI | `auto` (chooses itself); Claude and GPT-5.3-Codex available |
| OpenAI Codex CLI | GPT-5.5 (recommended); GPT-5.4 mini for fast subagent tasks |

Release dates and history are in the [news log](./AI_NEWS_LOG.md).
Opus 4.7 has a known change: sampling parameters (`temperature` etc.) now return 400 errors.

## Cross-tool capabilities

All three tools have skills, stable hooks, subagents and a plan/analysis mode.

- **Claude Code:** native binary, `/ultrareview` (cloud-based code review), `/code-review`, `/goal`, plugins from `.zip`/URL, conditional/defer hooks, Windows without Git Bash
- **GitHub Copilot CLI:** BYOK + local models (`COPILOT_OFFLINE`), remote control of sessions, enterprise-managed plugins via a `.github-private` repo, `gh skill` for portable skills, `/security-review`, HTTP hooks
- **OpenAI Codex CLI:** stable hooks, `/goal` workflows as the default, `codex marketplace add`, `codex doctor`, Amazon Bedrock support

## Open follow-up items

- ⚠️ **Copilot's project-level `.claude/commands|agents|rules` rows are unverified.** For SKILLS this is resolved (verified against CLI 1.0.79, 2026-08-13): personal skills come from `~/.agents/skills/` (not `~/.claude/skills/`), project-level `.claude/skills/` is still read. Whether the CLI still reads project-level `.claude/commands/`, `.claude/agents/` and `.claude/rules/` has NOT been re-verified.
- **The config cells in the tables below have not been hands-on re-verified** against the latest versions — items marked ⚠️ should be checked at the next update.
- The `effort` frontmatter on skills is in use (`low`/`medium`/`high`/`xhigh`) — Claude Code-specific.

---

## Configuration overview

Which files each tool reads automatically:

| File/directory | Claude Code | Copilot | Codex |
|-----------|:-----------:|:-------:|:-----:|
| `CLAUDE.md` | ✅ primary | ✅ read | ✅ read |
| `AGENTS.md` | — | ✅ read | ✅ primary |
| `.claude/rules/*.md` | ✅ auto-include | ✅ read | — |
| `.claude/skills/` | ✅ native skills | ✅ read (verified 1.0.79) | — |
| `.github/skills/` | — | ✅ native skills | — |
| `.agents/skills/` | — | ✅ read | ✅ read |
| `~/.agents/skills/` | — | ✅ personal skills (verified 1.0.79) | ✅ read |
| `~/.copilot/skills/` | — | ✅ global skills | — |
| `.claude/commands/*.md` | ✅ slash commands | ✅ read | — |
| `.claude/agents/*.md` | ✅ agents | ✅ read | — |
| `.claude/settings.json` | ✅ MCP + hooks | — | — |
| `.github/copilot-instructions.md` | — | ✅ primary | — |
| `.github/instructions/**/*.instructions.md` | — | ✅ path-specific | — |
| `~/.copilot/copilot-instructions.md` | — | ✅ global | — |
| `~/.codex/AGENTS.md` | — | — | ✅ global |
| `~/.codex/config.toml` | — | — | ✅ MCP |

> ⚠️ **The Copilot `.claude/commands|agents|rules` rows need re-verification.** The
> skills rows are verified against CLI 1.0.79 (2026-08-13): project-level `.claude/skills/`
> is still read; personal skills come from `~/.agents/skills/`, and `~/.claude/skills/` is
> no longer read. The commands/agents/rules rows have not been re-verified — see
> [Open follow-up items](#open-follow-up-items).

---

## Claude Code

**Version and last verified:** see [Supported versions](#supported-versions)

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

**Version and last verified:** see [Supported versions](#supported-versions)

### Instruction files (read automatically)

| File | Description |
|-----|-------------|
| `.github/copilot-instructions.md` | Repository-wide instructions — primary |
| `.github/instructions/**/*.instructions.md` | Path-specific instructions |
| `~/.copilot/copilot-instructions.md` | Global user instructions |
| `CLAUDE.md` | Also read (compatibility with Claude Code) |
| `AGENTS.md` | Also read |

**Important:** Copilot additionally reads the `.claude/` structure:

> ⚠️ **The commands/agents/rules rows need re-verification.** The `.claude/skills/` row
> is verified against CLI 1.0.79 (2026-08-13). The remaining rows have not been
> re-checked. See [Open follow-up items](#open-follow-up-items).

| File | Description |
|-----|-------------|
| `.claude/skills/` | Agent skills — read automatically (verified against 1.0.79) |
| `.claude/commands/*.md` | Slash commands — read by the Copilot CLI |
| `.claude/agents/*.md` | Custom agents — read by the Copilot CLI |
| `.claude/rules/*.md` | Rule files — read by the Copilot CLI |

**Skills (native Copilot locations):**

| File | Description |
|-----|-------------|
| `.github/skills/*/SKILL.md` | Repo-specific skills (Copilot's native location) |
| `.agents/skills/*/SKILL.md` | Repo-specific skills (shared standard with Codex) |
| `~/.agents/skills/*/SKILL.md` | Personal skills (aide installs `core/skills/` here) |
| `~/.copilot/skills/*/SKILL.md` | Global skills (shared across projects) |

Since we already have skills in `.claude/skills/`, Copilot picks them up automatically — we do not need to duplicate them to `.github/skills/`.

### Features

- **Slash commands** — reads the personal skills from `~/.agents/skills/` (e.g. `/aide-create`)
- **Agent Mode** — can execute multi-step workflows autonomously
- **MCP:** Support via the GitHub MCP server

### Installation into target projects

`install.sh` installs globally — `AGENTS.md` becomes `~/.copilot/copilot-instructions.md`,
the skills go to `~/.agents/skills/` (shared with Codex), and the shared scripts end up in
`~/.local/bin/`. The projects therefore need no Copilot config of their own.

### Implementation

```text
implementations/copilot/
└── install.sh / uninstall.sh ← installs core/AGENTS.md → ~/.copilot/copilot-instructions.md

(The instruction file is generated to core/AGENTS.md by core/scripts/build-agents-md.sh)
```

---

## Codex CLI

**Version and last verified:** see [Supported versions](#supported-versions)

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

- **No aide slash commands** — workflows are driven via the `~/.codex/AGENTS.md` instructions
- **MCP:** Support via `~/.codex/config.toml`
- **Parallel execution** — can work on several tasks at once

### Implementation

```text
implementations/codex/
├── config.toml                 ← sandbox + MCP
├── install.sh / uninstall.sh   ← global install: ~/.codex/AGENTS.md + shared scripts
└── mcp/                        ← MCP setup docs
```

---

## Installation into target projects

When you install aide into a target project (e.g. my-app):

### Minimum requirements per tool

| Tool | Required files |
|---------|----------------|
| Claude Code | `.claude/` (commands, rules, agents, skills), `CLAUDE.md` |
| Copilot | `.github/copilot-instructions.md` **and** `.claude/` (commands, rules, agents) |
| Codex | `~/.codex/AGENTS.md` (from `core/AGENTS.md`) |

### Automated installation

```bash
# Claude Code
implementations/claude-code/setup.sh

# Copilot
implementations/copilot/install.sh

# Codex
implementations/codex/install.sh (if present)
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

---

## See also

- [AI_NEWS_LOG.md](./AI_NEWS_LOG.md) — News log / research feed that feeds this matrix
- [AI_DEVELOPMENT_GUIDE.md](./AI_DEVELOPMENT_GUIDE.md) — Architecture and design patterns
- [implementations/claude-code/](../implementations/claude-code/) — Claude Code implementation
- [implementations/copilot/](../implementations/copilot/) — Copilot implementation
- [implementations/codex/](../implementations/codex/) — Codex implementation
