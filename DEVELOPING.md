# Developer guide for Aide

## Table of contents

- [Tools you need](#tools-you-need)
- [Directory structure](#directory-structure)
- [Adding new functionality](#adding-new-functionality)
  - [New skill](#new-skill)
  - [Updating rules](#updating-rules)
  - [Updating Copilot instructions](#updating-copilot-instructions)
- [Installation](#installation)
- [The dashboard](#the-dashboard)
- [Architecture](#architecture)

---

This guide is for you who want to **contribute to or further develop** Aide.


## Tools you need

Using Aide needs what each installer's own INSTALL.md lists. Developing it
also needs the tools its checks run on — the same five commands CI runs on a
pull request:

| Tool              | Used by                                                                                   | Install                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Python 3.14       | `.venv/bin/pytest`, the root's gate                                                       | `brew install python@3.14`, then `python3.14 -m venv .venv && .venv/bin/pip install -r requirements.txt` |
| bun               | `cd dashboard && make test`, the dashboard's gate                                         | `brew install oven-sh/bun/bun` (or mise; the version is `dashboard/bun.lock`'s)                          |
| markdownlint-cli2 | `npx markdownlint-cli2 '**/*.md'`                                                         | fetched by `npx`, needs Node.js                                                                          |
| shellcheck        | `scripts/check-bash`, over every bash script in `core/scripts` and `dashboard/test/round` | `brew install shellcheck`                                                                                |
| agnix             | `scripts/check-agents`, over skills, rules, CLAUDE.md, agents and hooks                   | fetched by `npx` at the version the script pins, needs Node.js                                           |

`scripts/check-bash` refuses with the install command when shellcheck is
missing, so a machine without it never reports a bash change as checked.

**A change to the documentation has its own command.** `scripts/check-docs` runs the tests that read a page where code
depends on its text — the lifecycle diagram against `transitions.json`, the skills' frontmatter, step headings and the
script names they call, the templates' placeholders — with `core/tests/specs/unit/core/validation` and
`core/tests/specs/unit/core/skills`, and the dashboard's own guards with `test/guards` and `test/design`. That takes about
ten seconds against the four minutes both full suites take.

`.githooks/pre-push` runs it before a push that moves `main`, and nothing on a push to a working branch. Turn it on
once per clone:

```bash
git config core.hooksPath .githooks
```

A push straight to `main` has nothing else in front of it: the board's landing gates what the board runs, and CI runs
on a pull request only. `AIDE_SKIP_PRE_PUSH=1` skips the hook and says on the way out that it did.

`.githooks/commit-msg`, turned on by the same line, refuses a commit whose message names a tool: a `Co-Authored-By`
trailer or a `Claude-Session` line. A commit message describes the change as a developer on the project would.

**Installing on Linux** is checked by `scripts/test-linux-install`, which needs Docker: it installs Aide in a clean
Debian container the way a new user would, checks the tools, scripts and skills, and starts the dashboard. With `--run`
and a token from `claude setup-token` in `CLAUDE_CODE_OAUTH_TOKEN`, it also queues one spec on the dashboard and takes
it from create to archive, landing included. Run it after changing an installer or a script the runner uses.

---

## Directory structure

The repository is two parts side by side:

- **`core/`** is the method: the skills, rules and templates installed into the AI tools, the scripts they and the
  runner call, the installers for each tool, and their pytest suite. It works without the dashboard.
- **`dashboard/`** is the board that queues and runs specs, with its own toolchain (Bun + TypeScript). It uses `core/`,
  never the other way round.

The runner, `core/scripts/aide-run-spec`, is the dashboard's engine, but it lives in `core/scripts/` with the scripts
it calls, since it is installed beside them in `~/.local/bin/`.

```text
aide/
│
├── core/                          # THE METHOD (shared by all AI tools)
│   ├── skills/                    # Skills (SKILL.md per directory)
│   │   ├── tdd-coach/
│   │   └── ...
│   ├── rules/                     # Always-loaded rules — installed to ~/.claude/rules/
│   │   ├── git.md
│   │   ├── testing.md
│   │   ├── spec-structure.md      # path-scoped: loaded only for spec files
│   │   └── ...
│   ├── scripts/                   # Shared scripts and the runner — installed to ~/.local/bin/
│   ├── templates/                 # Document templates
│   ├── implementations/           # One installer per AI tool
│   │   ├── claude-code/           # settings.json (Claude Code permissions for aide itself), install.sh, uninstall.sh
│   │   ├── codex/                 # ~/.codex/AGENTS.md, hooks, MCP snippets
│   │   ├── opencode/              # ~/.config/opencode/AGENTS.md
│   │   └── copilot/               # core/AGENTS.md → ~/.copilot/copilot-instructions.md
│   └── tests/                     # pytest, run from the root (pytest.ini)
│
├── dashboard/                     # THE BOARD — its own toolchain (Bun + TypeScript)
│   ├── src/                       # Site generator + the Bun server behind /live and /queue
│   ├── deploy/                    # rsync publish, launchd plist rendering
│   ├── test/                      # bun test — NOT part of the pytest suite
│   └── Makefile                   # test / test-slow / test-e2e / test-all / serve-local / install-serve / deploy-serve / install-local
│
├── docs/                          # Documentation for the whole repository
├── scripts/                       # The repository's own checks (check-bash, check-docs, ...)
└── install-all.sh                 # Runs every installer in core/implementations/
```

---

## Adding new functionality

### New skill

All skills (both expert skills and aide-* workflow skills) live in `core/skills/`.

Example: Adding `database-expert`

```bash
# 1. Create the skill
mkdir -p core/skills/database-expert
vim core/skills/database-expert/SKILL.md

# 2. Add it to the SKILLS list in uninstall.sh

# 3. Install and test
cd core/implementations/claude-code && ./install.sh

# 4. Commit
git add core/skills/database-expert/
git commit -m "Add database-expert skill"
```

### Updating rules

```bash
vim core/rules/testing.md
cd core/implementations/claude-code && ./install.sh
```

### Updating Copilot instructions

Copilot, Codex and OpenCode get `core/AGENTS.md`, which is built from
`core/agents-intro.md` and `core/rules/`:

```bash
vim core/agents-intro.md              # or a file in core/rules/
core/scripts/build-agents-md.sh
cd core/implementations/copilot && ./install.sh
```

---

## Installation

```bash
# Claude Code
cd core/implementations/claude-code && ./install.sh

# Copilot
cd core/implementations/copilot && ./install.sh

# Codex
cd core/implementations/codex && ./install.sh

# OpenCode
cd core/implementations/opencode && ./install.sh

# All four
./install-all.sh

# Uninstall Claude Code
cd core/implementations/claude-code && ./uninstall.sh
```

---

## The dashboard

`dashboard/` is bun and TypeScript, with commands of its own: see
[Developing the dashboard](dashboard/docs/developing.md).

---

## Architecture

### Core principles

1. **Direct sources:** Instruction files are direct source files; the one build step is `core/AGENTS.md`, generated
   from `core/rules/` by `core/scripts/build-agents-md.sh`
2. **Separation:** Generic content (`core/`) vs AI-specific (`core/implementations/`)

### Installation overview

| What                 | Source                                     | Installed to                         |
| -------------------- | ------------------------------------------ | ------------------------------------ |
| Skills               | `core/skills/`                             | `~/.claude/skills/`                  |
| Scripts              | `core/scripts/`                            | `~/.local/bin/`                      |
| Agents               | `core/implementations/claude-code/agents/` | `~/.claude/agents/`                  |
| Rules                | `core/rules/`                              | `~/.claude/rules/`                   |
| Copilot instructions | `core/AGENTS.md`                           | `~/.copilot/copilot-instructions.md` |

### Special cases

- **Aide:** `.claude/CLAUDE.md` and `.claude/settings.json` are git-tracked and never overwritten by install.sh
- **The AI installations are global** and apply to all your projects
- **aide-* skills:** Are slash commands (skills) in Claude Code/Copilot — not standalone CLI scripts
