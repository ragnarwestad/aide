---
name: ai-tools-reference
description: >-
  Verified configuration reference for the three AI tools aide supports:
  Claude Code, GitHub Copilot and OpenAI Codex. Covers instruction files,
  skill discovery paths, frontmatter field support, rules, agents, hooks,
  MCP and config formats, with a comparison matrix and source links.
  Use when: answering which tool reads which path, changing an installer,
  adding or moving a skill, checking frontmatter field support, updating
  the support matrix. Do NOT use for: news about new releases (use
  check-news), general web questions about the tools.
---

# AI tools reference

Verified configuration overview for all AI tools we support.
This file is the source of truth — don't guess, look it up here.

Last verified: 2026-03-28

## Table of contents

- [Cross-cutting standards](#cross-cutting-standards)
- [Claude Code](#claude-code)
- [GitHub Copilot](#github-copilot)
- [OpenAI Codex CLI](#openai-codex-cli)
- [Comparison](#comparison)
- [Sources](#sources)

---

## Cross-cutting standards

### Skills (SKILL.md)

Skills are a cross-cutting standard. All three tools read skills from
overlapping paths:

| Path                                | Claude Code |            Copilot            | Codex |
|-------------------------------------|:-----------:|:-----------------------------:|:-----:|
| `~/.claude/skills/<name>/SKILL.md`  |     yes     | no (dropped; verified 1.0.79) |  no   |
| `~/.copilot/skills/<name>/SKILL.md` |     no      |              yes              |  no   |
| `~/.agents/skills/<name>/SKILL.md`  |     no      |        yes (v1.0.11+)         |  yes  |
| `.claude/skills/<name>/SKILL.md`    |     yes     |              yes              |  no   |
| `.github/skills/<name>/SKILL.md`    |     no      |              yes              |  no   |
| `.agents/skills/<name>/SKILL.md`    |     no      |              yes              |  yes  |

**Format:** Folder with `SKILL.md` as the entry point. YAML frontmatter with
`name` and `description` (required). Markdown body with instructions.

**Frontmatter fields** (mapped 2026-08-13, spec 71 in aide-specs): the
[Agent Skills spec](https://agentskills.io/specification) defines exactly six
fields — `name`, `description`, `license`, `compatibility`, `metadata`,
`allowed-tools`. Tool support:

| Field                                                                |     Spec     |   Claude Code   | Copilot |  Codex  |
|----------------------------------------------------------------------|:------------:|:---------------:|:-------:|:-------:|
| `name`, `description`                                                |     yes      |       yes       |   yes   |   yes   |
| `license`                                                            |     yes      | accepted, inert |   yes   | ignored |
| `compatibility`, `metadata`                                          |     yes      | accepted, inert | ignored | ignored |
| `allowed-tools`                                                      | experimental |    enforced     |   yes   | ignored |
| `effort`, `argument-hint`                                            |      no      |       yes       | ignored | ignored |
| 12 more Claude Code fields (`model`, `context`, `hooks`, `paths`, …) |      no      |       yes       | ignored | ignored |

**aide's policy (additive-only):** beyond the spec's six fields, skills may
only use Claude Code extras that degrade additively — a tool that ignores
them loses a nicety, never a guarantee. Today that is `effort` and
`argument-hint`. The allowlist is enforced by
`tests/specs/unit/core/validation/test_core_skills.py`; behavior-critical
fields (`disable-model-invocation`, `user-invocable`, `context`, `hooks`)
are banned by default. Note: claude.ai uploads and the Skills API
**hard-error** on any non-spec field, so the skills cannot be uploaded there
as-is — a deliberate trade-off.

**Copilot no longer reads `~/.claude/commands/`** (verified against 1.0.79 with
a probe file, 2026-08-13 — it used to read them as skills). Project-level
`.claude/commands/*.md` IS still read as skills (same verification).

**Important for aide:** `~/.claude/skills/` is read by Claude Code only —
the Copilot CLI stopped reading it (verified hands-on against 1.0.79 with a
probe skill, 2026-08-13). Copilot and Codex read the personal skills from
`~/.agents/skills/`, where the copilot and codex installers put `core/skills/`
via `core/scripts/_install-skills.sh`. Project-level `.claude/skills/` is
still read by the Copilot CLI (same verification).

### Instruction files

All tools have a project instruction file that is read automatically:

| Tool        | File                               | Global                               |
|-------------|------------------------------------|--------------------------------------|
| Claude Code | `CLAUDE.md` or `.claude/CLAUDE.md` | `~/.claude/CLAUDE.md`                |
| Copilot     | `.github/copilot-instructions.md`  | `~/.copilot/copilot-instructions.md` |
| Codex       | `AGENTS.md`                        | `~/.codex/AGENTS.md`                 |

**Copilot also reads the others' files** (only in Coding Agent):
`AGENTS.md` and `CLAUDE.md` in the repo root.

---

## Claude Code

**Docs:** <https://code.claude.com/docs/>

### Configuration files

| File                | Path                                                        | Purpose                                        |
|---------------------|-------------------------------------------------------------|------------------------------------------------|
| CLAUDE.md           | `./CLAUDE.md`, `./.claude/CLAUDE.md`, `~/.claude/CLAUDE.md` | Instructions                                   |
| settings.json       | `.claude/settings.json`, `~/.claude/settings.json`          | Permissions, hooks, env                        |
| settings.local.json | `.claude/settings.local.json`                               | Local overrides (gitignored)                   |
| Skills              | `~/.claude/skills/<name>/SKILL.md`                          | Slash commands                                 |
| Rules               | `~/.claude/rules/*.md`, `.claude/rules/*.md`                | Automatically loaded rules                     |
| Agents              | `~/.claude/agents/*.md`, `.claude/agents/*.md`              | Subagent definitions                           |
| Commands            | `~/.claude/commands/*.md`                                   | Unified with skills (both create `/` commands) |
| MCP                 | `~/.claude/.mcp.json`, `.claude/.mcp.json`                  | MCP servers                                    |
| Memory              | `~/.claude/projects/<project>/memory/`                      | Auto-memory                                    |

### Rules

Markdown files in `.claude/rules/` or `~/.claude/rules/`. Optional
YAML frontmatter with `paths` (glob or YAML list of globs) for
path-specific rules. Without `paths` they are always loaded at session start.

### Agents

Markdown with YAML frontmatter. Key fields: `name`, `description`,
`tools`, `model`, `skills`, `mcpServers`, `hooks`, `memory`, `isolation`.

### Hooks

Configured in settings.json. Events: `PreToolUse`, `PostToolUse`,
`UserPromptSubmit`, `Stop`, `SessionStart`, `SubagentStart`,
`CwdChanged`, `FileChanged`, `TaskCreated`, `StopFailure` and more.
Hook types: `command`, `http`, `prompt`, `agent`.
Hooks support an `if` field with permission rule syntax for conditional execution.

### Skill/Agent frontmatter

Skills and agents support these frontmatter fields:

| Field             | Purpose                                              |
|-------------------|------------------------------------------------------|
| `name`            | Identifier                                           |
| `description`     | Trigger matching (max ~250 chars shown in `/skills`) |
| `effort`          | Reasoning effort for the skill (low/medium/high)     |
| `maxTurns`        | Max number of turns for the agent                    |
| `disallowedTools` | Tools the agent does not have access to              |
| `initialPrompt`   | Auto-submit first turn                               |
| `paths`           | YAML list of globs for path-specific activation      |

---

## GitHub Copilot

**Docs:** <https://docs.github.com/en/copilot>

### Configuration files

| File                | Path                                                                              | Purpose                         |
|---------------------|-----------------------------------------------------------------------------------|---------------------------------|
| Custom instructions | `.github/copilot-instructions.md`                                                 | Repo-wide instructions          |
| Path-specific       | `.github/instructions/*.instructions.md`                                          | Path-specific rules             |
| Global instructions | `~/.copilot/copilot-instructions.md`                                              | Personal instructions           |
| Skills              | `~/.claude/skills/`, `~/.copilot/skills/`, `~/.agents/skills/`, `.github/skills/` | SKILL.md-based skills           |
| Custom agents       | `.github/agents/*.md`                                                             | Agent definitions               |
| CLI config          | `~/.copilot/config.json`                                                          | CLI configuration               |
| VS Code settings    | `.vscode/settings.json`                                                           | IDE configuration               |
| Coding Agent env    | `.github/workflows/copilot-setup-steps.yml`                                       | CI environment for Coding Agent |

### Path-specific instructions

Files in `.github/instructions/` with the `.instructions.md` suffix.
Require YAML frontmatter with an `applyTo` glob:

```yaml
---
applyTo: "**/*.ts,**/*.tsx"
---
```

### Custom agents

Files in `.github/agents/*.md`. YAML frontmatter with `name`,
`description`, `tools`, `model`, `mcp-servers`.

### AGENTS.md support

Copilot reads `AGENTS.md` in the repo root and cwd. Supported in:
VS Code chat, Coding Agent (all environments), CLI. NOT in JetBrains
chat, Visual Studio chat, Eclipse chat.

### Monorepo support (v1.0.11+)

From v1.0.11 Copilot CLI discovers skills, instructions, MCP servers
and agents at every directory level from cwd up to the git root. This
means projects can have project-specific skills in
`.github/skills/` that supplement the global ones in `~/.claude/skills/`.

### What Copilot does NOT read

- `~/.claude/skills/` — Claude Code only (CLI dropped it; verified 1.0.79)
- `~/.claude/rules/` — Claude Code only
- `~/.claude/agents/` — Claude Code only
- `.claude/CLAUDE.md` — Coding Agent only (not VS Code chat or CLI)

---

## OpenAI Codex CLI

**Docs:** <https://developers.openai.com/codex/cli>
**Repo:** <https://github.com/openai/codex>

### Configuration files

| File               | Path                                                | Purpose                             |
|--------------------|-----------------------------------------------------|-------------------------------------|
| AGENTS.md          | Repo root and down to cwd                           | Instructions (directory walk)       |
| AGENTS.override.md | Same paths                                          | Override without deleting AGENTS.md |
| config.toml        | `~/.codex/config.toml`, `<repo>/.codex/config.toml` | Configuration                       |
| Skills             | `~/.agents/skills/`, `.agents/skills/`              | SKILL.md-based skills               |
| hooks.json         | `~/.codex/hooks.json`, `<repo>/.codex/hooks.json`   | Hooks (experimental)                |

### AGENTS.md

Plain Markdown. Codex walks from the git root down to cwd and concatenates
all AGENTS.md files. `AGENTS.override.md` takes precedence at each level.
Max 32 KiB total (`project_doc_max_bytes`).

### config.toml

Key sections: `model`, `approval_policy`, `sandbox_mode`,
`project_doc_fallback_filenames`. Supports profiles via
`[profiles.<name>]`.

### Plugins (v0.117.0+)

Plugins are now a first-class workflow in Codex. Synced at startup,
browsed with `/plugins`, installed/removed with auth handling.
Sub-agents use path-based addresses (`/root/agent_a`) with
structured inter-agent messaging.

---

## Comparison

### Instructions and rules

| Feature              |     Claude Code     |              Copilot               |       Codex        |
|----------------------|:-------------------:|:----------------------------------:|:------------------:|
| Project instructions |      CLAUDE.md      |      copilot-instructions.md       |     AGENTS.md      |
| Path-specific rules  |  rules/ with paths  |   instructions/*.instructions.md   |         no         |
| Directory walk       |         yes         |          no (single file)          |   yes (root→cwd)   |
| Global instructions  | ~/.claude/CLAUDE.md | ~/.copilot/copilot-instructions.md | ~/.codex/AGENTS.md |
| File import          |         no          |                 no                 |         no         |

### Skills and commands

| Feature           |        Claude Code        |   Copilot   |    Codex    |
|-------------------|:-------------------------:|:-----------:|:-----------:|
| Skills (SKILL.md) |            yes            |     yes     |     yes     |
| Custom commands   | unified with skills (.md) |     no      |     no      |
| Slash commands    |        /skill-name        | /skill-name | /skill-name |
| Auto-activation   |  yes (description match)  |     yes     |     yes     |

### Configuration

| Feature          | Claude Code |        Copilot        |         Codex          |
|------------------|:-----------:|:---------------------:|:----------------------:|
| Config format    |    JSON     |         JSON          |          TOML          |
| Config path      |  .claude/   |  .github/, .vscode/   |        .codex/         |
| MCP servers      |     yes     |     yes (agents)      |          yes           |
| Hooks            |     yes     |          no           |   yes (experimental)   |
| Agents/subagents |     yes     | yes (.github/agents/) | yes (v0.117+, plugins) |

---

## Sources

### Claude Code

- Docs: <https://code.claude.com/docs/>
- Memory/CLAUDE.md: <https://code.claude.com/docs/en/memory.md>
- Settings: <https://code.claude.com/docs/en/settings.md>
- Skills: <https://code.claude.com/docs/en/skills.md>
- Agents: <https://code.claude.com/docs/en/sub-agents.md>
- Hooks: <https://code.claude.com/docs/en/hooks.md>
- MCP: <https://code.claude.com/docs/en/mcp.md>

### GitHub Copilot

- Custom instructions: <https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot>
- Support matrix: <https://docs.github.com/en/copilot/reference/custom-instructions-support>
- CLI instructions: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions>
- Skills: <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills>
- CLI skills: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills>
- Custom agents: <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents>
- CLI config: <https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli>
- Coding Agent env: <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment>

### OpenAI Codex

- Docs: <https://developers.openai.com/codex/cli>
- AGENTS.md: <https://developers.openai.com/codex/guides/agents-md>
- Config: <https://developers.openai.com/codex/config-advanced>
- Skills: <https://developers.openai.com/codex/skills>
- MCP: <https://developers.openai.com/codex/mcp>
- Hooks: <https://developers.openai.com/codex/hooks>
- Repo: <https://github.com/openai/codex>
