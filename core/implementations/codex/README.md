# OpenAI Codex implementation

## Table of contents

- [Install](#install)
- [What it installs](#what-it-installs)
- [Check it worked](#check-it-worked)
- [What to know about Codex](#what-to-know-about-codex)
  - [A project's CLAUDE.md](#a-projects-claudemd)
  - [The size of AGENTS.md](#the-size-of-agentsmd)
  - [Hooks](#hooks)
  - [MCP servers](#mcp-servers)
- [Resources](#resources)

---

For a person installing Aide for the OpenAI Codex CLI, or checking that install. The prerequisites, what every
installer does, updating and uninstalling are in [docs/INSTALLATION.md](../../../docs/INSTALLATION.md); which files
Codex reads, verified against an installed version, is in
[docs/AI_SUPPORT_MATRIX.md](../../../docs/AI_SUPPORT_MATRIX.md#codex-cli).

## Install

You need a ChatGPT plan that includes Codex; the CLI signs in with it.

```bash
mise use -g npm:@openai/codex@latest   # the Codex CLI, kept current by upgrade-ai-tools
codex login

cd ~/develop/aide
core/implementations/codex/install.sh
```

Run on its own, the installer asks whether to add two optional MCP servers ([MCP servers](#mcp-servers)).
`./install-all.sh` answers no to both.

---

## What it installs

On top of [what every installer puts in place](../../../docs/INSTALLATION.md#what-every-installer-puts-in-place):

| What                                                          | Where                                                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Aide's rules (`core/AGENTS.md`)                               | `~/.codex/AGENTS.md`, in a marked block                                |
| `project_doc_fallback_filenames = ["CLAUDE.md"]`              | The top of `~/.codex/config.toml`                                      |
| The hooks                                                     | `~/.codex/hooks.json`, beside your own, and `~/.codex/hooks/aide-*.sh` |
| Every skill in `core/skills/`                                 | `~/.agents/skills/`, shared with Copilot                               |
| On request, the MCP servers in `mcp/*.toml`                   | Appended to `~/.codex/config.toml`                                     |

---

## Check it worked

```bash
aide-preflight codex
codex exec "List the skills you have whose names start with aide-"
```

The answer names Aide's skills, such as `aide-explore`. The spec steps (create, analyze and the rest) are not
skills; they run on the board ([Where a spec's steps run](../../../docs/INSTALLATION.md#where-a-specs-steps-run)).

---

## What to know about Codex

### A project's CLAUDE.md

Codex reads only `AGENTS.md` as a project's instructions unless `project_doc_fallback_filenames` names other files.
The installer writes `project_doc_fallback_filenames = ["CLAUDE.md"]` at the top of `~/.codex/config.toml`, under a
comment saying who wrote it, so a project with only a `CLAUDE.md` still gives Codex its instructions. A value already
set there is left as it is. `uninstall.sh` removes the two lines only while they stand as the installer wrote them.

### The size of AGENTS.md

Codex reads at most `project_doc_max_bytes` of an `AGENTS.md`, 32768 by default, and drops the rest without saying
so. `core/AGENTS.md` therefore holds only the rules that apply to every turn; the task-specific guidance is in the
skills, which Codex reads when they are relevant.

### Hooks

The installer merges `hooks/hooks.json` into `~/.codex/hooks.json` and copies the `hooks/aide-*.sh` scripts to
`~/.codex/hooks/`. The hooks need `jq`.

| Hook                                        | Event              | What it does                                                  |
| ------------------------------------------- | ------------------ | ------------------------------------------------------------- |
| `aide-markdownlint.sh`                      | PostToolUse        | Lints a markdown file right after it is edited                |
| `command-rules/block-git-add-all.sh`        | PreToolUse         | Refuses `git add .` and `git add -A`                          |
| `command-rules/block-watch-mode.sh`         | PreToolUse         | Refuses a test runner started in watch mode                   |
| `aide-track-turn.sh` + `aide-stop-guard.sh` | PostToolUse + Stop | Refuses to end a turn where source code changed without tests |

The two command rules are the scripts in `~/.local/bin/lib/command-rules/`, which Claude Code runs too. An install
replaces the entries an earlier install wrote, and removes the old `~/.codex/hooks/aide-block-*.sh` scripts once
`~/.codex/hooks.json` no longer calls them.

**Codex runs only the hooks it trusts.** The first interactive `codex` session after an install asks you to approve
them once; until then, a headless `codex exec` runs them only with `--dangerously-bypass-hook-trust`.

### MCP servers

Each MCP server is a `[mcp_servers.<name>]` table in `~/.codex/config.toml`:

<!-- fragment: context7.toml -->
```toml
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
```

The installer offers two sets and appends the matching file from `mcp/` when you say yes:

- `mcp/browser-testing.toml` — Playwright and Chrome DevTools ([BROWSER_TESTING_MCP_SETUP.md](mcp/BROWSER_TESTING_MCP_SETUP.md))
- `mcp/context7.toml` — Context7 ([CONTEXT7_MCP_SETUP.md](mcp/CONTEXT7_MCP_SETUP.md))

---

## Resources

- [Codex CLI](https://developers.openai.com/codex/cli)
- [The Codex repository](https://github.com/openai/codex)
