---
name: ai-tools-reference
description: >-
  Verified configuration reference for three of the AI tools Aide supports:
  Claude Code, GitHub Copilot and OpenAI Codex (OpenCode only where noted). Covers instruction files,
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

**Aide's policy (additive-only):** beyond the spec's six fields, skills may
only use Claude Code extras that degrade additively — a tool that ignores
them loses a nicety, never a guarantee. Today that is `effort` and
`argument-hint`. The allowlist is enforced by
`core/tests/specs/unit/core/validation/rules/test_core_skills.py`; behavior-critical
fields (`disable-model-invocation`, `user-invocable`, `context`, `hooks`)
are banned by default. Note: claude.ai uploads and the Skills API
**hard-error** on any non-spec field, so the skills cannot be uploaded there
as-is — a deliberate trade-off.

**Copilot no longer reads `~/.claude/commands/`** (verified against 1.0.79 with
a probe file, 2026-08-13 — it used to read them as skills). Project-level
`.claude/commands/*.md` IS still read as skills (same verification).

**Important for Aide:** `~/.claude/skills/` is read by Claude Code only —
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
| OpenCode    | `AGENTS.md`                        | `~/.config/opencode/AGENTS.md`       |

**Copilot also reads the others' files** (only in Coding Agent):
`AGENTS.md` and `CLAUDE.md` in the repo root.

**Claude Code falls back to `AGENTS.md`** (v2.1.277): a project with no
`CLAUDE.md` has its `AGENTS.md` read instead — not yet on Bedrock, Vertex or
Foundry. A project that has a `CLAUDE.md` is read as before.
**Codex falls back to `CLAUDE.md`**: Aide's installer sets
`project_doc_fallback_filenames = ["CLAUDE.md"]` (verified 0.171.0). OpenCode 2
reads only `AGENTS.md`; Aide adds `"CLAUDE.md"` to `instructions` in its global
config, which reads it beside `AGENTS.md` too (verified 2.3.0). In a project the user owns, `AGENTS.md` holds the
instructions and `CLAUDE.md` holds `@AGENTS.md`; Aide writes neither file.

### Plugins as a way to install Aide

All four tools take plugins, and none can carry Aide's whole setup, so Aide
installs files instead (verified 2026-11-22):

| Tool        | A plugin can ship                         | Always-on rules                                        | Note                                                         |
|-------------|-------------------------------------------|--------------------------------------------------------|--------------------------------------------------------------|
| Claude Code | skills, hooks, agents, MCP, LSP, `bin/`   | no: a plugin `CLAUDE.md` is ignored, no `rules/`       | Hook `additionalContext` capped at 10,000 characters         |
| Codex       | skills, hooks, MCP, apps                  | no AGENTS.md text, no `config.toml` keys               | Install writes `config.toml`; plugin hooks need trust        |
| Copilot     | skills, agents, hooks, MCP, LSP, rules    | yes: `com.github.copilot/rules/` with `alwaysApply`    | A personal skill of the same name wins over the plugin's     |
| OpenCode    | TS module: skills, commands, system text  | yes, from code (`ctx.session.hook("context", ...)`)    | Still a `plugins` entry or a file in `~/.config/opencode/`   |

Claude Code, Codex and Copilot name a plugin's skills `plugin:skill`, so
`aide-implement` would be called by a new name. Plugins load headless in
`claude -p` (not `--bare`) and `copilot -p`; for `codex exec` and
`opencode run` it is not documented. Revisit when Claude Code and Codex
plugins can ship always-on instructions (`docs/ROADMAP.md`, item 8).

---

## Claude Code

**Docs:** <https://code.claude.com/docs/>

### Configuration files

| File                | Path                                                         | Purpose                                                                                                                          |
|---------------------|--------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------|
| CLAUDE.md           | `./CLAUDE.md`, `./.claude/CLAUDE.md`, `~/.claude/CLAUDE.md`  | Instructions                                                                                                                     |
| settings.json       | `.claude/settings.json`, `~/.claude/settings.json`           | Permissions, hooks, env                                                                                                          |
| settings.local.json | `.claude/settings.local.json`                                | Local overrides (gitignored)                                                                                                     |
| Skills              | `~/.claude/skills/<name>/SKILL.md`                           | Slash commands                                                                                                                   |
| claude.ai sync      | `syncClaudeAiSkills`, `syncClaudeAiPlugins` in settings.json | Skills and plugins enabled on claude.ai appear in terminal sessions beside `~/.claude/skills` (v2.1.275); `false` turns each off |
| Rules               | `~/.claude/rules/*.md`, `.claude/rules/*.md`                 | Automatically loaded rules                                                                                                       |
| Agents              | `~/.claude/agents/*.md`, `.claude/agents/*.md`               | Subagent definitions                                                                                                             |
| Commands            | `~/.claude/commands/*.md`                                    | Unified with skills (both create `/` commands)                                                                                   |
| MCP                 | `~/.claude/.mcp.json`, `.claude/.mcp.json`                   | MCP servers                                                                                                                      |
| Memory              | `~/.claude/projects/<project>/memory/`                       | Auto-memory                                                                                                                      |

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
Hook types: `command`, `http`, `mcp_tool`, `prompt`, `agent`. An
`mcp_tool` hook calls a tool on a configured MCP server and treats its
text output like a command hook's stdout.
Hooks support an `if` field with permission rule syntax for conditional execution.

What happens when a hook fails or times out:

- `timeout` is in seconds. The default is 600 for `command`, `http` and
  `mcp_tool`, 30 for `prompt` and 60 for `agent`.
- A failed or timed-out hook does not stop the action unless the hook
  sets `"onFailure": "block"`; then the failure counts as exit code 2.
  `onFailure` works on `command` and `http` hooks from v2.1.295, and on
  `mcp_tool` hooks from v2.1.328. It has no effect on `Stop`,
  `SubagentStop`, `TaskCompleted`, `TeammateIdle` or background hooks.
  This repo's push guard (`scripts/guard-push`) sets it, so a guard that
  crashes or times out stops the push. The hooks Aide installs into
  other projects do not, so a crash there lets the command through.

Code Mode and refused calls (v2.1.328):

- Code Mode no longer runs `UserPromptSubmit` hooks on a script's
  output. Output that must be redacted is handled in a `PostToolUse`
  hook that returns `updatedToolOutput`.
- Managed `PostToolUse` hooks no longer fire for a call that was refused
  before it ran; `PostToolBatch` receives most of those calls, without
  marking them as refused.
- Aide installs no `UserPromptSubmit`, `mcp_tool` or managed hooks, so
  neither change touches it.

Code Mode from v2.1.329:

- A `PreToolUse` hook that fails or times out in Code Mode no longer
  refuses the call by default; a required check sets `"onFailure":
  "block"`. The push guard already does. Code Mode never runs under
  `-p`, so the runner is not affected.
- `Stop` and `SubagentStop` list a Monitor's script as `monitor`, not
  `shell`, in `background_tasks`. Nothing in Aide reads that field.

Matchers match the whole identifier, never a substring (v2.1.195): a
hyphenated name such as `mcp__brave-search` needs `mcp__brave-search__.*`
to cover every tool of that server. Aide's own matchers (`Edit|Write`,
`Bash`, `""`) name whole tools already — verified 2026-09-14.

### Headless runs (`-p`)

`--permission-prompts none` (v2.1.259) denies anything that would prompt
on a host nobody is watching; the permission mode still decides the rest.
Verified on 2.1.270: `-p` already does exactly this without the flag — a
tool that would prompt is denied and listed under `permission_denials`
either way — so `aide-run-spec` leaves it out of its argv on purpose.
`-p --resume <session-id>` continues a session the same run started.
A `PermissionRequest` hook fires in `-p` too: outside `dontAsk` and with
no permission host, a call that would prompt is denied unless such a hook
answers `allow` (verified on 2.1.331, 2026-11-24: a Bash call in
`default` mode was denied without the hook and ran with it). Aide
installs no `PermissionRequest` hook.
`defaultMode: "bypassPermissions"` is ignored in a project's
`.claude/settings.json` (v2.1.257), and the permission-modes page says
the same of `"auto"` — set either in user or managed settings. Aide
never edits `~/.claude/settings.json`: the template in
`core/implementations/claude-code/settings.json` says `"default"`, but a
machine may hold `"auto"`, and a bare `claude -p` there starts in auto
mode (the dashboard's own `claude -p /usage` and `/model` do; they call
no tool).

The mode a `-p` run starts in is the first of: `--permission-mode` (or
`--dangerously-skip-permissions`), `permissions.defaultMode` in a
settings file, the built-in default. The built-in default for `-p` is
`default`, which the CLI shows as Manual and accepts as `manual`; a
terminal session starts in `auto` from v2.1.283. `--permission-mode
default` is accepted although `--help` no longer lists it, and an
unknown value is refused before any model call. `aide-run-spec` passes
`--permission-mode` on every Claude turn — the step, a resumed session,
the review — so no default reaches a queue run, and `--permission-mode`
outranks any `defaultMode`. The mode is the step's entry in the host's
`queue-config.json`, else the code's default (`acceptEdits`;
`bypassPermissions` for implement). It also passes `--add-dir` for each
root outside the project worktree. These are the only two flags it passes
that bear on permissions. Verified on 2.1.309, 2026-10-23: with no flag,
`system/init` reports `default` under `--setting-sources project` and
`auto` under user settings holding `"auto"`; `--permission-mode
acceptEdits` and `bypassPermissions` report the mode passed either way.

Auto mode and v2.1.304 to v2.1.309, against a `-p` run:

- Auto mode as the default for Claude web, desktop and mobile (October
  2026): the apps only; no CLI default changes.
- v2.1.304: `/auto-mode-setup` is interactive and sets no mode. `rm -r`
  of a mounted drive or a top-level folder now gets the safety prompt,
  which `-p` denies in `acceptEdits` and `bypassPermissions` alike
  (release notes; not probed).
- v2.1.305, v2.1.306, v2.1.307, v2.1.308: no change to the mode or to
  which commands prompt in `-p`.
- v2.1.309: no change to the mode. `sed -i` gets the standard Bash
  prompt instead of counting as a file edit, so a step on `acceptEdits`
  is denied both `sed -i '' 's/a/b/' x.txt` and `sed -i.bak 's/a/b/'
  x.txt` on a file inside its working directory ("sed command requires
  approval", under `permission_denials`), while plain `sed 's/a/b/'
  x.txt` runs; the permission-modes page still lists `sed` among the
  commands `acceptEdits` approves. By the release notes, a wrapped or
  prefixed `cd` before `git` is newly denied there too (not probed). A
  step on `bypassPermissions` is not affected. Sandbox and `Edit(path)`
  deny hardening apply to settings Aide does not set. `claude
  ultrareview` needs `--trust-workspace` in a script; `aide-run-spec`
  never calls it.

### Scheduling, connectors, plugins and Haiku (v2.1.330)

- Recurring scheduled tasks and `/loop` run up to 30 days while their
  session runs; a task made before v2.1.330 still ends after 7.
- A `deniedMcpServers` name entry hides only the claude.ai connector it
  names; denying the exact URL blocks every connector there.
- `claude plugin install --json` adds `commandPrinted` (the install
  command wrote to stderr) and `commandFailed` (it failed, was killed or
  timed out). Aide's installer reads only the exit status.
- Haiku 5.5 may refuse (`stop_reason: "refusal"`) before or after partial
  output, with no server-side fallback. `reasoning_extraction` refuses a
  prompt, skill or tool description asking it to write its reasoning in
  the response; a retry is usually refused again, so remove the
  instruction. Aide's skills and rules ask for no such thing.

### Plugins, traces and responses (v2.1.331)

- A plugin manifest may list `optionalDependencies`: plugins installed
  with it that can be disabled or uninstalled on their own.
- `CLAUDE_CODE_DISABLE_RESPONSE_COMPRESSION` asks for uncompressed
  responses behind a proxy that cuts compressed ones off. Not advised yet
  for self-hosted runners or Remote Control.
- `claude_code.llm_request` trace spans carry `gen_ai.usage.*`,
  `gen_ai.response.model` and `gen_ai.operation.name`;
  `gen_ai.usage.input_tokens` includes prompt cache tokens.
- On or after 2026-11-30, a marketplace in managed
  `extraKnownMarketplaces` updates automatically by default;
  `"autoUpdate": false` on its entry turns that off. Aide sets no managed
  marketplaces.

### Claude Ship and `/ship` (beta, 2026-11-23)

[Source](https://claude.com/resources/articles/introducing-claude-ship).
Claude Ship is three parts working on a GitHub pull request:

- **Code Review** (generally available) reviews at a Quick, Standard or
  Deep level and posts its findings.
- **PR Steward** (beta) fixes failing checks, merge conflicts and review
  findings, and comments after each push. It never approves or merges.
- **Claude Approvals** (beta) approves or asks for a person by a policy
  file in the repository, and can run in observe-only mode.

`/ship` in Claude Code pushes the branch, opens the pull request, and
works on findings and failing checks; it counts as ordinary Claude Code
use. Claude Ship is for Team and Enterprise plans on GitHub, and is
billed on tokens, with spend limits for Code Review and PR Steward. It is
not offered with Zero Data Retention, the HIPAA configuration or
customer-managed keys. Aide does not use it: Merge on the board tests the
merged result and updates the default branch itself.

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

A skill's `model` setting applies to that skill's own calls only
(v2.1.330): subagents, forks, compaction and `/recap` stay on the
session's model. A `context: fork` skill is the exception and runs wholly
on its model. The skills in `core/skills/` cannot set `model`: the
frontmatter allowlist in `test_core_skills.py` does not permit it.

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
| Workspace MCP       | `.mcp.json`, `.github/mcp.json`                                                   | MCP servers (JSONC, v1.0.116+)  |
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

Copilot reads `AGENTS.md` in the repo root and cwd. The CLI supports it,
which is the only surface aide uses.

### Monorepo support (v1.0.11+)

From v1.0.11 Copilot CLI discovers skills, instructions, MCP servers
and agents at every directory level from cwd up to the git root. This
means projects can have project-specific skills in
`.github/skills/` that supplement the global ones in `~/.claude/skills/`.

### Workspace MCP servers and the `env` setting (v1.0.116+)

Copilot CLI loads a workspace's MCP servers from `.mcp.json` and
`.github/mcp.json`. From v1.0.116 both may be JSONC: comments and
trailing commas no longer stop the servers from loading.

From the same version the `env` setting sets environment variables for
every process Copilot starts: shell commands, local LSP and MCP servers,
hooks and extensions, with or without the sandbox. Aide sets no `env`.
A variable set in the environment that starts `copilot` also reaches
the shell commands it runs; `test_copilot_e2e.py` checks that with a
marker variable and `AIDE_INSTALLATION_PATH`.

### Plugins, team defaults and policy

Copilot plugins are named `PLUGIN-NAME@MARKETPLACE-NAME`; awesome-copilot
is the built-in marketplace. Plugins can be switched on from several
places, and they do not carry the same weight:

- **Enterprise managed settings** — `copilot/managed-settings.json` in the
  enterprise's `.github-private` repository. They can require or block a
  plugin or a marketplace, but cannot turn an optional plugin on by
  default. A user cannot override them.
- **Enterprise team settings** — files in `copilot/teams/` mapped by
  `copilot/team-mappings.json`, with `enabledPlugins` added on top of the
  enterprise's. They count as managed policy, so a user cannot override
  them either.
- **Team defaults** (Copilot Business and Enterprise) — set by a team
  maintainer or organization owner on the team's "Customize Copilot" tab
  on github.com. The plugins are on by default for the team's direct
  members in Copilot CLI, VS Code and the Copilot app; members of child
  teams do not get them. Enterprise and organization policy wins over
  them, and a member can turn one off in their client where policy
  allows it. GitHub does not say how the CLI does that.
- **Repository defaults** — `enabledPlugins` and `extraKnownMarketplaces`
  in `.github/copilot/settings.json`. They cannot make a plugin
  mandatory or switch on one that policy blocks, and a user can turn one
  off locally.

Aide installs no Copilot plugins and sets none of these. A Copilot
session may still carry plugins the team or enterprise switched on.

Connectors (verified MCP servers such as Supabase or Box) are reached in
the CLI through `/mcp`, on the Connectors tab. They are in public preview;
on Business and Enterprise an admin must enable the `Editor preview
features` policy. The enterprise MCP allowlist (`allowedMcpServers`,
`deniedMcpServers`) also covers connectors on clients that support MCP
managed settings.

### What Copilot does NOT read

- `~/.claude/skills/` — Claude Code only (CLI dropped it; verified 1.0.79)
- `~/.claude/rules/` — Claude Code only
- `~/.claude/agents/` — Claude Code only
- `.claude/CLAUDE.md` — Coding Agent only; the CLI does not read it

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

From v0.172 ([source](https://github.com/openai/codex/releases/tag/rust-v0.172.0)):

- An optional stdio MCP server whose tool list is cached starts on its
  first tool call, not with the session.
- A connected app's tools can each have their own approval reviewer.
- `code_mode_host_grpc` is deprecated: Code Mode always uses gRPC. Aide
  does not set it.

**Turning skills off** ([source](https://learn.chatgpt.com/docs/build-skills),
2026-11-03). A skill is disabled without being deleted by a
`[[skills.config]]` entry in `~/.codex/config.toml`. Each entry takes
exactly one selector: `path`, an absolute path that matches one
`SKILL.md`, or `name`, which matches every skill with that name. When
several entries match a skill, the last one wins. All the bundled system
skills are turned off for one project with `[skills.bundled]` in that
project's trusted `.codex/config.toml`. Codex reads the change on restart.

```toml
[[skills.config]]   # in ~/.codex/config.toml
name = "linear"
enabled = false

[skills.bundled]   # in a trusted project's .codex/config.toml
enabled = false
```

### Headless runs (`codex exec`)

`codex exec --json` reads the prompt from stdin and prints JSONL; the
`thread.started` event carries the thread id. Without `-m` it runs the first
model in the account's catalogue: `gpt-6.2-sol` on 0.171.0 (verified
2026-11-21). `--remote <addr>` (v0.171) runs the turn on an existing app
server instead of a local one; Aide does not use it.
`codex exec resume <id> [prompt]` continues that thread and `codex exec fork <id>` branches it
(v0.148); both take `--json`, `-m`, `--output-schema` and
`--dangerously-bypass-approvals-and-sandbox`, but neither `--sandbox`
nor `--add-dir` (verified on 0.154.0). From v0.172 a resumed thread
keeps the sandbox, working directory and workspace roots it started with
unless overridden, and `-c sandbox_mode="<mode>"` overrides the sandbox
(verified on 0.172.0, 2026-11-24): `aide-run-spec` passes it on every
resume outside `bypassPermissions`. Hook trust granted once persists through `codex exec`
thread start and resume (v0.141). An untrusted project gets no
project-level `AGENTS.md` (v0.150). Aide's own instructions are global
(`~/.codex/AGENTS.md`), which trust does not gate; a project that ships
its own `AGENTS.md` needs the checkouts and worktrees the runner works
in listed under `[projects]` in `~/.codex/config.toml`.

### Plugins (v0.110.0+, stable)

Browsed with `/plugins`; from a script, `codex plugin marketplace add
<path|git>` then `codex plugin add PLUGIN@MARKETPLACE`, stored under
`~/.codex/plugins/cache/`. What a plugin can hold is under "Plugins as a
way to install Aide" above. Sub-agents use path-based addresses (`/root/agent_a`) with
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
| Config path      |  .claude/   | .github/, ~/.copilot/ |        .codex/         |
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
- Plugins: <https://code.claude.com/docs/en/plugins/manifest-reference.md>
- MCP: <https://code.claude.com/docs/en/mcp.md>
- Permission modes: <https://code.claude.com/docs/en/permission-modes>
- Release notes: <https://github.com/anthropics/claude-code/releases>
- Haiku 5.5 refusals: <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5>

### GitHub Copilot

- Custom instructions: <https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot>
- Support matrix: <https://docs.github.com/en/copilot/reference/custom-instructions-support>
- CLI instructions: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions>
- Skills: <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills>
- CLI skills: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills>
- Custom agents: <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents>
- CLI config: <https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli>
- Workspace MCP JSONC and `env` for spawned processes (v1.0.116): <https://github.com/github/copilot-cli/releases/tag/v1.0.116>
- Coding Agent env: <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment>
- Plugins and their precedence: <https://docs.github.com/copilot/concepts/customizations/plugins>
- CLI plugins: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating>
- Team defaults: <https://github.blog/changelog/2026-11-18-customize-github-copilot-for-your-team>
- Enterprise team settings: <https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise/use-managed-settings/override-settings-for-teams>
- Connectors: <https://github.blog/changelog/2026-11-18-connect-supabase-box-calendly-and-more-to-copilot>
- MCP allowlist: <https://docs.github.com/enterprise-cloud@latest/copilot/how-tos/administer-copilot/manage-mcp-usage/configure-enterprise-allowlist>

### OpenAI Codex

- Docs: <https://developers.openai.com/codex/cli>
- AGENTS.md: <https://developers.openai.com/codex/guides/agents-md>
- Config: <https://developers.openai.com/codex/config-advanced>
- Skills: <https://developers.openai.com/codex/skills>
- MCP: <https://developers.openai.com/codex/mcp>
- Hooks: <https://developers.openai.com/codex/hooks>
- Plugins: <https://developers.openai.com/codex/plugins/build>
- Repo: <https://github.com/openai/codex>
