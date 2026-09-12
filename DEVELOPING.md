# Developer guide for aide

This guide is for you who want to **contribute to or further develop** aide.

## Table of contents

- [Tools you need](#tools-you-need)
- [Directory structure](#directory-structure)
- [Adding new functionality](#adding-new-functionality)
  - [New skill](#new-skill)
  - [Updating rules](#updating-rules)
  - [Updating Copilot instructions](#updating-copilot-instructions)
- [Installation](#installation)
- [Architecture](#architecture)

---

## Tools you need

Using aide needs what each installer's own INSTALL.md lists. Developing it
also needs the tools its checks run on — the same four commands CI runs:

| Tool | Used by | Install |
|---|---|---|
| Python 3.9 | `.venv/bin/pytest`, the root's gate | `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` |
| bun | `cd dashboard && make test`, the dashboard's gate | `brew install oven-sh/bun/bun` (or mise; the version is `dashboard/bun.lock`'s) |
| markdownlint-cli2 | `npx markdownlint-cli2 '**/*.md'` | fetched by `npx`, needs Node.js |
| shellcheck | `scripts/check-bash`, over every bash script in `core/scripts` | `brew install shellcheck` |

`scripts/check-bash` refuses with the install command when shellcheck is
missing, so a machine without it never reports a bash change as checked.

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
│   ├── scripts/                   # CLI scripts: aide-generate-pdf, aide-generate-html
│   └── templates/                 # Document templates
│
├── dashboard/                     # The aide dashboard — its own toolchain (Bun + TypeScript)
│   ├── src/                       # Site generator + the Bun server behind /live and /queue
│   ├── deploy/                    # rsync publish, launchd plist rendering
│   ├── test/                      # bun test — NOT part of the pytest suite at the root
│   └── Makefile                   # generate / publish / serve-local / install-serve
│
├── implementations/               # AI-SPECIFIC ADAPTATIONS
│   │
│   ├── claude-code/
│   │   ├── CLAUDE.md              # Template — installed to .claude/CLAUDE.md in each project
│   │   ├── agents/                # Agent definitions — installed to ~/.claude/agents/
│   │   │   └── task-analyzer.md
│   │   ├── settings.json          # Claude Code permissions (aide itself)
│   │   ├── install.sh
│   │   └── uninstall.sh
│   │
│   └── copilot/
│       ├── .github/
│       │   └── copilot-instructions.md  # Installed to .github/ in each project
│       ├── keybindings.json       # VS Code keybindings (manual step)
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
vim core/skills/workflows/SKILL.md
cd implementations/claude-code && ./install.sh
```

### Updating Copilot instructions

```bash
vim implementations/copilot/.github/copilot-instructions.md
cd implementations/copilot && ./install.sh
```

---

## Installation

```bash
# Claude Code
cd implementations/claude-code && ./install.sh

# Copilot
cd implementations/copilot && ./install.sh

# Uninstall Claude Code
cd implementations/claude-code && ./uninstall.sh
```

---

## Architecture

### Core principles

1. **Direct sources:** Instruction files are direct source files — no build step
2. **Separation:** Generic content (`core/`) vs AI-specific (`implementations/`)

### Installation overview

| What                 | Source                                                    | Installed to                                |
|----------------------|-----------------------------------------------------------|---------------------------------------------|
| Skills               | `core/skills/`                                            | `~/.claude/skills/`                         |
| Scripts              | `core/scripts/`                                           | `~/.local/bin/`                             |
| Agents               | `implementations/claude-code/agents/`                     | `~/.claude/agents/`                         |
| Rules                | `core/rules/`                                             | `~/.claude/rules/`                          |
| CLAUDE.md (template) | `implementations/claude-code/CLAUDE.md`                   | `<project>/.claude/CLAUDE.md`               |
| Copilot instructions | `implementations/copilot/.github/copilot-instructions.md` | `<project>/.github/copilot-instructions.md` |

### Special cases

- **aide:** `.claude/CLAUDE.md` and `.claude/settings.json` are git-tracked and never overwritten by install.sh
- **The AI installations are global** and apply to all your projects
- **aide-* skills:** Are slash commands (skills) in Claude Code/Copilot — not standalone CLI scripts
