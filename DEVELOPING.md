# Developer guide for Aide

This guide is for you who want to **contribute to or further develop** Aide.

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

## Tools you need

Using Aide needs what each installer's own INSTALL.md lists. Developing it
also needs the tools its checks run on — the same five commands CI runs on a
pull request:

| Tool              | Used by                                                                                   | Install                                                                         |
|-------------------|-------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|
| Python 3.9        | `.venv/bin/pytest`, the root's gate                                                       | `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`            |
| bun               | `cd dashboard && make test`, the dashboard's gate                                         | `brew install oven-sh/bun/bun` (or mise; the version is `dashboard/bun.lock`'s) |
| markdownlint-cli2 | `npx markdownlint-cli2 '**/*.md'`                                                         | fetched by `npx`, needs Node.js                                                 |
| shellcheck        | `scripts/check-bash`, over every bash script in `core/scripts` and `dashboard/test/round` | `brew install shellcheck`                                                       |
| agnix             | `scripts/check-agents`, over skills, rules, CLAUDE.md, agents and hooks                   | fetched by `npx` at the version the script pins, needs Node.js                  |

`scripts/check-bash` refuses with the install command when shellcheck is
missing, so a machine without it never reports a bash change as checked.

**A change to the documentation has its own command.** Fourteen tests read a page rather than the code — the table in
`.claude/CLAUDE.md`, the lifecycle diagram against `transitions.json`, the rules, the skills, the templates, the
dashboard's own docs guards — and they sit in both suites. `scripts/check-docs` runs exactly those, in about ten
seconds against the four minutes both full suites take.

`.githooks/pre-push` runs it before a push that moves `main`, and nothing on a push to a working branch. Turn it on
once per clone:

```bash
git config core.hooksPath .githooks
```

A push straight to `main` has nothing else in front of it: the board's landing gates what the board runs, and CI runs
on a pull request only. `AIDE_SKIP_PRE_PUSH=1` skips the hook and says on the way out that it did.

**Installing on Linux** is checked by `scripts/test-linux-install`, which needs Docker: it installs Aide in a clean
Debian container the way a new user would, checks the tools, scripts and skills, and starts the dashboard. With `--run`
and a token from `claude setup-token` in `CLAUDE_CODE_OAUTH_TOKEN`, it also queues one spec on the dashboard and takes
it from create to archive, landing included. Run it after changing an installer or a script the runner uses.

---

## Directory structure

```text
aide/
│
├── core/                          # SHARED CONTENT (shared by all AI tools)
│   ├── skills/                    # Skills (SKILL.md per directory)
│   │   ├── tdd-coach/
│   │   └── ...
│   ├── rules/                     # Always-loaded rules — installed to ~/.claude/rules/
│   │   ├── git.md
│   │   ├── testing.md
│   │   ├── spec-structure.md      # path-scoped: loaded only for spec files
│   │   └── ...
│   ├── scripts/                   # Shared scripts — installed to ~/.local/bin/
│   └── templates/                 # Document templates
│
├── dashboard/                     # The aide dashboard — its own toolchain (Bun + TypeScript)
│   ├── src/                       # Site generator + the Bun server behind /live and /queue
│   ├── deploy/                    # rsync publish, launchd plist rendering
│   ├── test/                      # bun test — NOT part of the pytest suite at the root
│   └── Makefile                   # test / test-slow / test-e2e / test-all / serve-local / install-serve / deploy-serve / install-local
│
├── implementations/               # AI-SPECIFIC ADAPTATIONS
│   │
│   ├── claude-code/
│   │   ├── agents/                # Agent definitions — installed to ~/.claude/agents/
│   │   │   └── task-analyzer.md
│   │   ├── settings.json          # Claude Code permissions (aide itself)
│   │   ├── install.sh
│   │   └── uninstall.sh
│   │
│   ├── codex/                     # ~/.codex/AGENTS.md, hooks, MCP snippets
│   ├── opencode/                  # ~/.config/opencode/AGENTS.md
│   └── copilot/                   # core/AGENTS.md → ~/.copilot/copilot-instructions.md
│       ├── install.sh
│       └── uninstall.sh
│
└── tests/                         # TESTS
    └── specs/
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
cd implementations/claude-code && ./install.sh

# 4. Commit
git add core/skills/database-expert/
git commit -m "Add database-expert skill"
```

### Updating rules

```bash
vim core/rules/testing.md
cd implementations/claude-code && ./install.sh
```

### Updating Copilot instructions

Copilot, Codex and OpenCode get `core/AGENTS.md`, which is built from
`core/agents-intro.md` and `core/rules/`:

```bash
vim core/agents-intro.md              # or a file in core/rules/
core/scripts/build-agents-md.sh
cd implementations/copilot && ./install.sh
```

---

## Installation

```bash
# Claude Code
cd implementations/claude-code && ./install.sh

# Copilot
cd implementations/copilot && ./install.sh

# Codex
cd implementations/codex && ./install.sh

# OpenCode
cd implementations/opencode && ./install.sh

# All four
./install-all.sh

# Uninstall Claude Code
cd implementations/claude-code && ./uninstall.sh
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
2. **Separation:** Generic content (`core/`) vs AI-specific (`implementations/`)

### Installation overview

| What                 | Source                                                    | Installed to                                |
|----------------------|-----------------------------------------------------------|---------------------------------------------|
| Skills               | `core/skills/`                                            | `~/.claude/skills/`                         |
| Scripts              | `core/scripts/`                                           | `~/.local/bin/`                             |
| Agents               | `implementations/claude-code/agents/`                     | `~/.claude/agents/`                         |
| Rules                | `core/rules/`                                             | `~/.claude/rules/`                          |
| Copilot instructions | `core/AGENTS.md`                                          | `~/.copilot/copilot-instructions.md`        |

### Special cases

- **Aide:** `.claude/CLAUDE.md` and `.claude/settings.json` are git-tracked and never overwritten by install.sh
- **The AI installations are global** and apply to all your projects
- **aide-* skills:** Are slash commands (skills) in Claude Code/Copilot — not standalone CLI scripts
