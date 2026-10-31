# AI Support Matrix

## Table of contents

- [Supported versions](#supported-versions)
- [Fidelity levels](#fidelity-levels)
- [How the Aide pieces land](#how-the-aide-pieces-land)
- [Current models](#current-models)
- [Cross-tool capabilities](#cross-tool-capabilities)
- [Open follow-up items](#open-follow-up-items)
- [Configuration overview](#configuration-overview)
- [Claude Code](#claude-code)
- [GitHub Copilot](#github-copilot)
- [Codex CLI](#codex-cli)
- [OpenCode](#opencode)
- [Installation](#installation)
- [See also](#see-also)

---

Overview of which AI tools we support, which versions have been verified,
and which configuration files each tool reads.

**Update this document** when you upgrade a tool or discover new/changed config support.


## Supported versions

| Tool               | Version | Last verified | Status       |
|--------------------|---------|---------------|--------------|
| Claude Code        | 2.1.314 | 2026-10-31    | ✅ Supported |
| GitHub Copilot CLI | 1.0.105 | 2026-10-31    | ✅ Supported |
| Codex CLI          | 0.165.0 | 2026-10-31    | ✅ Supported |
| OpenCode           | 2.2.1   | 2026-10-31    | ✅ Supported |

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

| Grade               | Meaning                                                                    | Guaranteed by         |
|---------------------|----------------------------------------------------------------------------|-----------------------|
| **E — Enforced**    | The tool mechanically enforces it (a hook blocks, config is applied)       | The tool              |
| **H — Heuristic**   | A tool feature usually triggers it (skill activation on description match) | The tool, best-effort |
| **I — Instruction** | Plain text the model usually follows — nothing checks it                   | The model             |
| **—**               | Does not land in this tool at all                                          | Nobody                |

An **I** is not worthless — most of Aide IS instructions — but an I that
everyone believed was an E is how rules break silently.

---

## How the Aide pieces land

| Aide piece                                                      | Claude Code                                    | Copilot                                              | Codex                                                                                                                                                                                 | OpenCode                                                       |
|-----------------------------------------------------------------|------------------------------------------------|------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------|
| Rules (git, testing, communication, …)                          | **E** — auto-loaded from `~/.claude/rules/`    | **I** — text in `~/.copilot/copilot-instructions.md` | **I** — text in `~/.codex/AGENTS.md`                                                                                                                                                  | **I** — text in `~/.config/opencode/AGENTS.md`                 |
| Skills (`/aide-create`, `/aide-explore`, …)                     | **H** — native, activated on description match | **H** — read from `~/.agents/skills/`                | **H** — read from `~/.agents/skills/`                                                                                                                                                 | **H** — scanned in `~/.agents/skills/` and `~/.claude/skills/` |
| Hooks (markdownlint, `git add .` block, watch-mode block, Stop) | **E** — enforced via `settings.json`           | **—**                                                | **E** — via `~/.codex/hooks.json` (verified live against 0.147.0; needs one-time hook trust, which `codex exec` keeps through thread start and resume since 0.141)                    | **—**                                                          |
| Agents (task-analyzer)                                          | **H** — invoked via the Agent tool             | **—**                                                | **—**                                                                                                                                                                                 | **—**                                                          |
| Spec workflow (explore → create → … → archive)                  | **H** — the skills carry it                    | **H** — the skills carry it                          | **H** — the skills carry it                                                                                                                                                           | **H** — the skills carry it                                    |

Verified hands-on against Copilot CLI 1.0.79 (`copilot skill list`,
2026-08-13): personal skills are read from `~/.agents/skills/` — **not**
`~/.claude/skills/` anymore (a probe skill placed only there was not listed).
Project-level `.claude/skills/` is still read. The copilot and codex
installers both install `core/skills/` to `~/.agents/skills/` via
`core/scripts/_install-skills.sh`; each skill is listed once, no duplication.

The Agent Skills standard that these skills follow is governed by the
Agentic AI Foundation, a neutral body that also holds MCP. The
specification at <https://agentskills.io/specification> defines the
frontmatter fields; the allowlist test follows it.

Skill frontmatter beyond `name`/`description` follows an additive-only
policy (spec 71 in aide-specs): only Claude Code extras whose absence
costs a nicety, never a guarantee (`effort`, `argument-hint`), enforced by
an allowlist test. See the frontmatter table in the ai-tools reference.

---

## Current models

| Tool               | Default / recommended model                                                                                                                           |
|--------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| Claude Code        | Claude Fable 5.1 (default Fable, v2.1.257); Opus 5 (v2.1.219) and Sonnet 5 (v2.1.197); Claude Haiku 5.5 (`claude-haiku-5-5`, default Haiku, v2.1.293) |
| GitHub Copilot CLI | `auto` (chooses itself); Claude Fable 5.1, Sonnet 5, Haiku 5.5, GPT-6 Astra and GPT-5.6 available                                                     |
| OpenAI Codex CLI   | GPT-6.1 Sol (bundled default since 0.159.1); GPT-6 Astra before it                                                                                    |
| OpenCode           | None of its own: every model is its provider's, named `provider/model`                                                                                |

Release dates and history are in the [news log](./AI_NEWS_LOG.md).

## Cross-tool capabilities

All three tools have skills, stable hooks, subagents and a plan/analysis mode.

- **Claude Code:** native binary, `/ultrareview` (cloud-based code review), `/code-review`, `/goal`, plugins from `.zip`/URL, conditional/defer hooks, Windows without Git Bash
- **GitHub Copilot CLI:** BYOK + local models (`COPILOT_OFFLINE`), remote control of sessions, enterprise-managed plugins via a `.github-private` repo, `gh skill` for portable skills, `/security-review`, HTTP hooks
- **OpenAI Codex CLI:** stable hooks, `/goal` workflows as the default, `codex marketplace add`, `codex doctor`, Amazon Bedrock support

## Open follow-up items

- ⏳ **The Copilot cells that need a real model call are unverified:** `CLAUDE.md`, repo `AGENTS.md` and project-level `.claude/agents/`, and the instructions files. The verified-stamped cells (skills and commands, read with `copilot skill list`) hold. Finish the sweep when a model call can be made from this machine.
- The `effort` frontmatter on skills is in use (`low`/`medium`/`high`/`xhigh`) — Claude Code-specific.

---

## Configuration overview

Which files each tool reads automatically:

| File/directory                              |    Claude Code    |               Copilot                |             Codex              |
|---------------------------------------------|:-----------------:|:------------------------------------:|:------------------------------:|
| `CLAUDE.md`                                 |    ✅ primary     |               ✅ read                | — (not read; verified 0.147.0) |
| `AGENTS.md`                                 |    ✅ fallback    |               ✅ read                | ✅ primary (verified 0.147.0)  |
| `.claude/rules/*.md`                        |  ✅ auto-include  |    ✅ read (confirmed v1.0.89-5)     |               —                |
| `.claude/skills/`                           | ✅ native skills  |      ✅ read (verified 1.0.79)       |               —                |
| `.github/skills/`                           |         —         |  ✅ native skills (verified 1.0.79)  |               —                |
| `.agents/skills/`                           |         —         |      ✅ read (verified 1.0.79)       |   ✅ read (verified 0.147.0)   |
| `~/.agents/skills/`                         |         —         | ✅ personal skills (verified 1.0.79) |            ✅ read             |
| `~/.copilot/skills/`                        |         —         |           ✅ global skills           |               —                |
| `.claude/commands/*.md`                     | ✅ slash commands | ✅ read as skills (verified 1.0.79)  |               —                |
| `.claude/agents/*.md`                       |     ✅ agents     |               ✅ read                |               —                |
| `.claude/settings.json`                     |  ✅ MCP + hooks   |                  —                   |               —                |
| `.github/copilot-instructions.md`           |         —         |              ✅ primary              |               —                |
| `.github/instructions/**/*.instructions.md` |         —         |           ✅ path-specific           |               —                |
| `~/.copilot/copilot-instructions.md`        |         —         |              ✅ global               |               —                |
| `~/.codex/AGENTS.md`                        |         —         |                  —                   |  ✅ global (verified 0.147.0)  |
| `~/.codex/config.toml`                      |         —         |                  —                   |   ✅ MCP (verified 0.147.0)    |

> ⚠️ **The Copilot `.claude/agents` row needs re-verification.** The skills and
> commands rows are verified against CLI 1.0.79 (2026-08-13): project-level
> `.claude/skills/` and `.claude/commands/` are still read; personal skills come from
> `~/.agents/skills/`, and `~/.claude/skills/` and `~/.claude/commands/` are no longer
> read. `.claude/rules/*.md` is confirmed by the Copilot CLI's own v1.0.89-5
> changelog. The agents row has not been re-verified — see
> [Open follow-up items](#open-follow-up-items).
>
> Claude Code reads `AGENTS.md` only in a folder with no `CLAUDE.md` (since
> 2.1.277), and not when it runs through Bedrock, Vertex or Foundry.

---

## Claude Code

**Version and last verified:** see [Supported versions](#supported-versions)

### Instruction files (read automatically)

| File                  | Description                                        |
|-----------------------|----------------------------------------------------|
| `CLAUDE.md`           | Primary instruction file — read at startup         |
| `~/.claude/CLAUDE.md` | Global instruction file (user level)               |
| `.claude/rules/*.md`  | Rule files — **automatically included** in context |

### Configuration

| File                        | Description                                       |
|-----------------------------|---------------------------------------------------|
| `.claude/settings.json`     | MCP servers, hooks, permissions                   |
| `.claude/skills/*/SKILL.md` | Native skills (activated by Claude automatically) |
| `.claude/commands/*.md`     | Slash commands (`/command`)                       |
| `.claude/agents/*.md`       | Custom agents (can be called with the Agent tool) |

### Features

- **Skills:** Activated automatically based on the context of the request
- **Slash commands:** The user types `/command`, Claude executes it
- **Agents:** Specialized sub-agents for parallel tasks
- **MCP:** Support for MCP servers via `settings.json`
- **MCP elicitation in `claude -p`:** the client tells a server it accepts
  elicitation (form and url), then answers every request with
  `{"action":"cancel"}` at once, so the tool gets a refusal and the run
  goes on (verified 2.1.310). `aide-run-spec` therefore does not deny
  elicitation: no headless run waits for an answer.
- **Sandbox in a headless step:** `aide-run-spec` passes `--settings` with
  `sandbox.enabled`, `failIfUnavailable: true` (2.1.316),
  `allowUnsandboxedCommands: false`,
  `autoAllowBashIfSandboxed: true`, `filesystem.allowWrite` of `~/` and the
  temporary directories, `network.allowLocalBinding: true`, and a fixed deny
  list as `denyRead`, `denyWrite` and `Read(...)`/`Edit(...)` deny rules
  (`core/scripts/lib/run-spec/setup/sandbox.sh`). Checked on 2.1.310:
  - the sandbox confines shell commands only; the file tools follow
    permission rules, and a `deny` rule wins over a global `allow`;
  - a permission rule must start `~/` or `//`; one that starts with a single
    `/` is read relative to the settings file and denies nothing;
  - `Write(...)` rules are not used for files; `Edit(...)` covers every
    tool that writes;
  - a symlink to a denied path is denied as well;
  - Chromium cannot start inside it (`bootstrap_check_in … Permission
    denied`); `network.allowMachLookup` does not help, since it allows
    looking a service up, not registering one.
- **Hooks:** Pre/post hooks for tool calls via `settings.json`
- **Auto-apply edits:** Can be configured to write files without confirmation

### Implementation

```text
core/implementations/claude-code/
├── INSTALL.md
├── setup.sh
└── config/project/.claude/     ← copied to the target project
```

---

## GitHub Copilot

**Version and last verified:** see [Supported versions](#supported-versions)

### Instruction files (read automatically)

| File                                        | Description                                |
|---------------------------------------------|--------------------------------------------|
| `.github/copilot-instructions.md`           | Repository-wide instructions — primary     |
| `.github/instructions/**/*.instructions.md` | Path-specific instructions                 |
| `~/.copilot/copilot-instructions.md`        | Global user instructions                   |
| `CLAUDE.md`                                 | Also read (compatibility with Claude Code) |
| `AGENTS.md`                                 | Also read                                  |

**Important:** Copilot additionally reads the `.claude/` structure:

> ⚠️ **The `.claude/agents/` row needs re-verification.** The `.claude/skills/` and
> `.claude/commands/` rows are verified against CLI 1.0.79 (2026-08-13). `.claude/rules/*.md`
> is confirmed by the Copilot CLI's own v1.0.89-5 changelog. The agents row has not been
> re-checked. See [Open follow-up items](#open-follow-up-items).

| File                    | Description                                                 |
|-------------------------|-------------------------------------------------------------|
| `.claude/skills/`       | Agent skills — read automatically (verified against 1.0.79) |
| `.claude/commands/*.md` | Read as skills by the Copilot CLI (verified against 1.0.79) |
| `.claude/agents/*.md`   | Custom agents — read by the Copilot CLI                     |
| `.claude/rules/*.md`    | Rule files — read by the Copilot CLI (confirmed v1.0.89-5)  |

**Skills (native Copilot locations):**

| File                           | Description                                         |
|--------------------------------|-----------------------------------------------------|
| `.github/skills/*/SKILL.md`    | Repo-specific skills (Copilot's native location)    |
| `.agents/skills/*/SKILL.md`    | Repo-specific skills (shared standard with Codex)   |
| `~/.agents/skills/*/SKILL.md`  | Personal skills (Aide installs `core/skills/` here) |
| `~/.copilot/skills/*/SKILL.md` | Global skills (shared across projects)              |

Since we already have skills in `.claude/skills/`, Copilot picks them up automatically — we do not need to duplicate them to `.github/skills/`.

### Features

- **Slash commands** — reads the personal skills from `~/.agents/skills/` (e.g. `/aide-create`)
- **Headless mode** — `copilot -p` runs a prompt with no one at the keyboard
- **MCP:** Support via the GitHub MCP server

### Installation into target projects

`install.sh` installs globally:

- `AGENTS.md` — becomes `~/.copilot/copilot-instructions.md`.
- The skills — go to `~/.agents/skills/` (shared with Codex).
- The shared scripts — end up in `~/.local/bin/`.

The projects therefore need no Copilot config of their own.

### Implementation

```text
core/implementations/copilot/
└── install.sh / uninstall.sh ← installs core/AGENTS.md → ~/.copilot/copilot-instructions.md

(The instruction file is generated to core/AGENTS.md by core/scripts/build-agents-md.sh)
```

---

## Codex CLI

**Version and last verified:** see [Supported versions](#supported-versions)

### Instruction files (read automatically)

| File                               | Description                                                                         |
|------------------------------------|-------------------------------------------------------------------------------------|
| `AGENTS.md` (`~/.codex/AGENTS.md`) | Primary instruction file (installed from `core/AGENTS.md`)                          |
| `CLAUDE.md`                        | Not read (verified 0.147.0) — needs `project_doc_fallback_filenames` in config.toml |

### Configuration

| File                   | Description                            |
|------------------------|----------------------------------------|
| `~/.codex/config.toml` | Global config: execPolicy, MCP servers |

### Features

- **Aide skills** — read from `~/.agents/skills/`, where the installer puts `core/skills/`
- **MCP:** Support via `~/.codex/config.toml`
- **Parallel execution** — can work on several tasks at once
- **Sandbox in a headless step:** `aide-run-spec` keeps
  `--dangerously-bypass-approvals-and-sandbox` for `bypassPermissions`.
  Checked on 0.164.0, `workspace-write` (with network access on) stops
  `git` in a worktree, whose git directory lies in the main checkout,
  stops writes to `~/.cache`, and still lets a command read `~/.ssh`: its
  sandbox confines writing but cannot deny reading.

### Implementation

```text
core/implementations/codex/
├── config.toml                 ← sandbox + MCP
├── hooks/                      ← hooks.json + aide-*.sh, installed to ~/.codex/
├── install.sh / uninstall.sh   ← global install: ~/.codex/AGENTS.md, hooks, skills, shared scripts
├── mcp/                        ← MCP setup docs + *.toml snippets appended to ~/.codex/config.toml
└── README.md
```

---

## OpenCode

**Version and last verified:** see [Supported versions](#supported-versions)

OpenCode reaches a model through a PROVIDER rather than bringing its own,
so a model is named `provider/model` and no provider is configured until
one is logged in (`opencode providers login`).

### Instruction files (read automatically)

| File                                         | Description                                                                                                                                                                                                                            |
|----------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `AGENTS.md` (`~/.config/opencode/AGENTS.md`) | Global instruction file (installed from `core/AGENTS.md`)                                                                                                                                                                              |
| `~/.claude/CLAUDE.md`                        | OpenCode 1: read only when `~/.config/opencode/AGENTS.md` does not exist, so not where Aide is installed. OpenCode 2: not read                                                                                                         |
| `AGENTS.md` / `CLAUDE.md` in the project     | OpenCode 1: the first of `AGENTS.md`, `CLAUDE.md` and `CONTEXT.md` that exists wins, searched from the working directory up to the root. OpenCode 2: `AGENTS.md` only, every one up to the project root, combined with the global file |

### Skills (read in place — nothing installed)

| Directory           | Description                                              |
|---------------------|----------------------------------------------------------|
| `~/.agents/skills/` | Scanned for `**/SKILL.md`, shared with Codex and Copilot |
| `~/.claude/skills/` | Scanned the same way, shared with Claude Code            |

A skill is reached through a `skill` tool, by name, not as a slash
command — which is why a headless step names its skill in words.

OpenCode 1 (1.19.0 on the serving host) does not use metadata to control
slash commands or automatic skill selection: an unknown frontmatter field
is ignored. OpenCode 2 does: a metadata key, or `disable-model-invocation:
true`, hides a skill from the model's list while it can still be loaded by
ID, and a prompt loads a skill by hand by mentioning it as `@skill-id`.
Aide's installed skills set neither, so both versions offer every one of
them to the model.

### Configuration

| File                               | Description                                   |
|------------------------------------|-----------------------------------------------|
| `~/.config/opencode/opencode.json` | Global config: providers, agents, permissions |

### Headless use

On OpenCode 1 (checked against 1.19.0), `opencode run --format json`
reads the prompt from stdin and prints one JSON event per line; OpenCode
2's CLI page documents none of these flags. Its flags:

- `--agent plan` — on 1.19.0 it denies file edits except Markdown plan
  files in `.opencode/plans/` in the project and in `plans/` under
  OpenCode's data directory, and it does not restrict shell commands. On
  its own it is therefore not read-only, so for the `plan` and `default`
  permission modes `core/scripts/lib/run-spec/setup/invocation.sh` also
  passes `OPENCODE_CONFIG_CONTENT` denying `edit`, `bash` and `task`, both
  for every agent and for the plan agent itself. That config outranks the
  project's `opencode.json`, but a project's rule for one agent outranks a
  general rule, hence both levels. The plan agent is left with glob, grep,
  read, skill, todowrite, webfetch and websearch (verified 1.19.0).
  OpenCode 2's plan agent likewise may write plan files and leaves shell
  commands to the permission config.
- `--agent build` — the default.
- `--auto` — additionally answers what it would otherwise ask about.
- `--session <id>` — continues a session.

MCP elicitation: `opencode run` does not tell a server it accepts
elicitation (its `initialize` sends only `roots`), so a server that
follows the MCP spec never asks, and the run never waits for an answer
(verified 1.19.0).

---

## Installation

Aide installs globally, not into each project: `./install-all.sh` runs
each `core/implementations/<ai>/install.sh`, and each one writes under the home
directory (`~/.claude/`, `~/.copilot/`, `~/.codex/`, `~/.config/opencode/`,
`~/.agents/skills/`, `~/.local/bin/`).

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

### Agent Skills standard

- [Agent Skills specification](https://agentskills.io/specification) — the frontmatter fields the allowlist test follows
- [ClaudeDevs: the standard under the Agentic AI Foundation](https://x.com/ClaudeDevs/status/2113328526413996100) — the source for its governance

---

## See also

- [AI_NEWS_LOG.md](./AI_NEWS_LOG.md) — News log / research feed that feeds this matrix
- [core/implementations/claude-code/](../core/implementations/claude-code) — Claude Code implementation
- [core/implementations/copilot/](../core/implementations/copilot) — Copilot implementation
- [core/implementations/codex/](../core/implementations/codex) — Codex implementation
