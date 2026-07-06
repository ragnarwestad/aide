# Utvikling i doc-aide

## Katalogstruktur

```text
core/
  skills/            Skills (SKILL.md) — delt av alle AI-verktøy som støtter det
  rules/             Felles regler (git, testing, koding etc.) — én kilde for alle
  scripts/           CLI-scripts + build-agents-md.sh (genererer AGENTS.md)
  templates/         Dokumentmaler
  agents-intro.md    Nøytral intro foran de felles reglene
  AGENTS.md          Generert (intro + core/rules/) — Copilot og Codex sin instruksjonsfil

implementations/     AI-spesifikke tilpasninger — dette er PRODUKTET
  claude-code/       agents/, settings.json, install.sh, uninstall.sh
  copilot/           install.sh, uninstall.sh, jetbrains/
  codex/             Codex-konfig, mcp/, scripts/
  gemini/            Gemini-konfig, mcp/

docs/                Dokumentasjon for utviklere (ikke lest av AI-verktøy)
```

## Hva installeres hvor

Alt installeres **globalt** — ikke per prosjekt. Prosjektene kan i tillegg
ha eget AI-oppsett.

**Inngang:** `./install-all.sh` (repo-rot) installerer alle fire AI-ene ved å
kjøre hver `implementations/<ai>/install.sh`. `/install-all`-skillen gjør det
samme. Vil du bare én AI, kjør dens script direkte (f.eks.
`implementations/codex/install.sh`).

Hver AI-installer er **selvstendig**: den installerer felles scripts
(`core/scripts/` → `~/.local/bin/`) *og* sitt eget AI-spesifikke oppsett. Den
felles scriptlista defineres ett sted — `core/scripts/_install-bin.sh` — som
hver installer source-er (`install_common_bin` / `uninstall_common_bin`). Lista
kopieres derfor flere ganger ved `install-all`, men vedlikeholdes bare ett sted.

### Claude Code (install.sh)

| Kilde | Installeres til |
|-------|-----------------|
| `core/skills/` | `~/.claude/skills/` |
| `core/scripts/` | `~/.local/bin/` |
| `core/rules/` | `~/.claude/rules/` |
| `implementations/claude-code/agents/` | `~/.claude/agents/` |

### Copilot (install.sh)

| Kilde | Installeres til |
|-------|-----------------|
| `core/AGENTS.md` | `~/.copilot/copilot-instructions.md` |
| `core/scripts/` | `~/.local/bin/` |

### Codex (install.sh)

| Kilde | Installeres til |
|-------|-----------------|
| `core/AGENTS.md` | `~/.codex/AGENTS.md` |
| `core/scripts/` | `~/.local/bin/` |
| `implementations/codex/scripts/codex-aide-*` | `~/.local/bin/` |

### Gemini (install.sh)

| Kilde | Installeres til |
|-------|-----------------|
| `core/AGENTS.md` | `~/.gemini/GEMINI.md` |
| `core/scripts/` | `~/.local/bin/` |
| `implementations/gemini/.gemini/commands/*.toml` | `~/.gemini/commands/` |

## Oppdatering av AI-verktøyene

CLI-verktøyene holdes oppdatert automatisk:

- **Claude Code** oppdaterer seg selv (auto-update på som standard).
- **Copilot, Codex og Gemini** styres av [mise](https://mise.jdx.dev/), pinnet til
  `latest` i `~/.config/mise/config.toml`.

`core/scripts/mise-upgrade-ai-tools` kjører `mise upgrade` på verktøyene +
`claude update`. Det installeres til `~/.local/bin/` av hver AI-installer (via
`core/scripts/_install-bin.sh`).

Scriptet kjøres daglig via cron — sett opp én gang per maskin:

```bash
crontab -e
# Legg til:
0 8 * * * ~/.local/bin/mise-upgrade-ai-tools
```

Matrisen (`docs/AI_SUPPORT_MATRIX.md`) speiler *sist verifiserte* versjoner og
oppdateres manuelt via `/check-news` — ikke av cron-jobben.

## Legge til ny funksjonalitet

### Ny skill

1. Les `docs/SKILL_GUIDE.md` for struktur og beste praksis
2. Opprett `core/skills/<navn>/SKILL.md` med frontmatter og kjerneinstruksjoner
3. Legg tung dokumentasjon i `core/skills/<navn>/references/`
4. Legg til i uninstall.sh sin SKILLS-liste
5. Kjør `cd implementations/claude-code && ./install.sh`

### Oppdatere regler

1. Rediger i `core/rules/` (felles kilde for alle AI-verktøy)
2. Kjør `core/scripts/build-agents-md.sh` (regenererer `core/AGENTS.md`)
3. Kjør `implementations/claude-code/install.sh` (regler → `~/.claude/rules/`), `implementations/copilot/install.sh` og `implementations/codex/install.sh` (ny AGENTS.md → `~/.copilot/` og `~/.codex/`)

### install.sh og uninstall.sh

Disse MÅ alltid speile hverandre. Ved endring i den ene, oppdater den andre.

Felles scripts (`core/scripts/` → `~/.local/bin/`) håndteres av
`core/scripts/_install-bin.sh` — endre scriptlista *der*, ikke i hver installer.
`install-all.sh` / `uninstall-all.sh` (repo-rot) kjører alle fire i rekkefølge.
