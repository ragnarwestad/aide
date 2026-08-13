# Development in doc-aide

## Directory structure

```text
core/
  skills/            Skills (SKILL.md) — shared by all AI tools that support it
  rules/             Shared rules (git, testing, coding etc.) — one source for all
  scripts/           CLI scripts + build-agents-md.sh (generates AGENTS.md)
  templates/         Document templates
  agents-intro.md    Neutral intro placed before the shared rules
  AGENTS.md          Generated (intro + core/rules/) — Copilot's and Codex's instruction file

implementations/     AI-specific adaptations — this is the PRODUCT
  claude-code/       agents/, settings.json, install.sh, uninstall.sh
  copilot/           install.sh, uninstall.sh
  codex/             Codex config, mcp/

docs/                Documentation for developers (not read by AI tools)
```

## What gets installed where

Everything is installed **globally** — not per project. Projects may also
have their own AI setup.

**Entry point:** `./install-all.sh` (repo root) installs all three AIs by
running each `implementations/<ai>/install.sh`. The `/install-all` skill does the
same. If you only want one AI, run its script directly (e.g.
`implementations/codex/install.sh`).

Each AI installer is **self-contained**: it installs the shared scripts
(`core/scripts/` → `~/.local/bin/`) *and* its own AI-specific setup. The
shared script list is defined in one place — `core/scripts/_install-bin.sh` — which
each installer sources (`install_common_bin`). The list is therefore copied
multiple times during `install-all`, but maintained in only one place.

**Individual uninstallers never remove the shared scripts** — other AI tools
and the cron job depend on them. Only `uninstall-all.sh` calls
`uninstall_common_bin` (as its final step).

### Claude Code (install.sh)

| Source | Installed to |
|-------|-----------------|
| `core/skills/` | `~/.claude/skills/` |
| `core/scripts/` | `~/.local/bin/` |
| `core/rules/` | `~/.claude/rules/` |
| `implementations/claude-code/agents/` | `~/.claude/agents/` |

### Copilot (install.sh)

| Source | Installed to |
|-------|-----------------|
| `core/AGENTS.md` | `~/.copilot/copilot-instructions.md` |
| `core/scripts/` | `~/.local/bin/` |

### Codex (install.sh)

| Source | Installed to |
|-------|-----------------|
| `core/AGENTS.md` | `~/.codex/AGENTS.md` |
| `core/scripts/` | `~/.local/bin/` |

## Updating the AI tools

The CLI tools are kept up to date automatically:

- **Claude Code** updates itself (auto-update on by default).
- **Copilot and Codex** are managed by [mise](https://mise.jdx.dev/), pinned to
  `latest` in `~/.config/mise/config.toml`.

`core/scripts/upgrade-ai-tools` runs `mise upgrade` on the tools +
`claude update`. It is installed to `~/.local/bin/` by each AI installer (via
`core/scripts/_install-bin.sh`).

The script runs daily via cron — set it up once per machine:

```bash
crontab -e
# Add:
0 8 * * * ~/.local/bin/upgrade-ai-tools
```

The matrix (`docs/AI_SUPPORT_MATRIX.md`) reflects the *last verified* versions and
is updated manually via `/check-news` — not by the cron job.

## Adding new functionality

### New skill

1. Read `docs/SKILL_GUIDE.md` for structure and best practices
2. Create `core/skills/<name>/SKILL.md` with frontmatter and core instructions
3. Put heavy documentation in `core/skills/<name>/references/`
4. Add it to the SKILLS list in uninstall.sh
5. Run `cd implementations/claude-code && ./install.sh`

### Updating rules

1. Edit in `core/rules/` (shared source for all AI tools)
2. Run `core/scripts/build-agents-md.sh` (regenerates `core/AGENTS.md`)
3. Run `implementations/claude-code/install.sh` (rules → `~/.claude/rules/`), `implementations/copilot/install.sh` and `implementations/codex/install.sh` (new AGENTS.md → `~/.copilot/` and `~/.codex/`)

### install.sh and uninstall.sh

These MUST always mirror each other. When changing one, update the other.

Shared scripts (`core/scripts/` → `~/.local/bin/`) are handled by
`core/scripts/_install-bin.sh` — change the script list *there*, not in each installer.
`install-all.sh` / `uninstall-all.sh` (repo root) run all three in sequence.
