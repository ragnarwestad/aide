# AI Support Matrix

Oversikt over hvilke AI-verktøy vi støtter, hvilke versjoner som er verifisert,
og hvilke konfigurasjonsfiler hvert verktøy leser.

**Oppdater dette dokumentet** når du oppgraderer et verktøy eller oppdager ny/endret konfig-støtte.

## Innholdsfortegnelse

- [Støttede versjoner](#støttede-versjoner)
- [Gjeldende modeller](#gjeldende-modeller)
- [Kapabiliteter på tvers](#kapabiliteter-på-tvers)
- [Åpne oppfølgingspunkter](#åpne-oppfølgingspunkter)
- [Konfigurasjonsoversikt](#konfigurasjonsoversikt)
- [Claude Code](#claude-code)
- [GitHub Copilot](#github-copilot)
- [Codex CLI](#codex-cli)
- [Gemini CLI](#gemini-cli)
- [Installasjon til målprosjekter](#installasjon-til-målprosjekter)
- [Se også](#se-også)

---

## Støttede versjoner

| Verktøy | Versjon | Sist verifisert | Status |
|---------|---------|-----------------|--------|
| Claude Code | 2.1.150 | 2026-05-23 | ✅ Støttet |
| GitHub Copilot CLI | v1.0.51 | 2026-05-23 | ✅ Støttet |
| Codex CLI | 0.133.0 | 2026-05-23 | ✅ Støttet |
| Gemini CLI | 0.43.0 | 2026-05-23 | ✅ Støttet |

Sjekk installerte versjoner:

```bash
claude --version
copilot --version
codex --version
gemini --version
```

---

## Gjeldende modeller

| Verktøy | Default / anbefalt modell |
|---------|---------------------------|
| Claude Code | Claude Opus 4.7 (også Fast mode og Auto på Max) |
| GitHub Copilot CLI | `auto` (velger selv); Claude og GPT-5.3-Codex tilgjengelig |
| OpenAI Codex CLI | GPT-5.5 (anbefalt); GPT-5.4 mini for raske subagent-oppgaver |
| Gemini CLI | Gemini 3 (default); Gemini 3.5 Flash / 3.1 Flash-Lite for fart |

Lanseringsdatoer og historikk ligger i [nyhetsloggen](./AI_NYHETSLOGG.md).
Opus 4.7 har en kjent endring: sampling-parametere (`temperature` m.fl.) gir nå 400-feil.

## Kapabiliteter på tvers

Alle fire verktøy har skills, stabile hooks, subagents og en plan-/analyse-modus.

- **Claude Code:** native binær, `/ultrareview` (skybasert kodegjennomgang), `/code-review`, `/goal`, plugins fra `.zip`/URL, conditional/defer hooks, Windows uten Git Bash
- **GitHub Copilot CLI:** BYOK + lokale modeller (`COPILOT_OFFLINE`), remote control av sesjoner, enterprise-managed plugins via `.github-private`-repo, `gh skill` for portable skills, `/security-review`, HTTP-hooks
- **OpenAI Codex CLI:** stabile hooks, `/goal`-workflows som default, `codex marketplace add`, `codex doctor`, Amazon Bedrock-støtte
- **Gemini CLI:** subagents, `/memory inbox`, git worktree-støtte, sanntids voice mode, native sandboxing

## Åpne oppfølgingspunkter

- ⚠️ **Copilot leser kanskje ikke lenger prosjekt-nivå `.claude/*`.** Copilot CLI sluttet å laste agents/skills/commands fra `~/.claude/` (personlig katalog er nå `~/.agents/skills/`). Om og hvordan prosjekt-nivå `.claude/`-celler fortsatt leses må re-verifiseres mot nyeste versjon — påvirker Copilot-installasjonsstrategien.
- **Konfig-cellene i tabellene under er ikke hands-on re-verifisert** mot nyeste versjoner — punkter merket ⚠️ bør sjekkes ved neste oppdatering.
- `effort`-frontmatter på skills er tatt i bruk (`low`/`medium`/`high`/`xhigh`) — Claude Code-spesifikt.

---

## Konfigurasjonsoversikt

Hvilke filer hvert verktøy leser automatisk:

| Fil/mappe | Claude Code | Copilot | Codex | Gemini |
|-----------|:-----------:|:-------:|:-----:|:------:|
| `CLAUDE.md` | ✅ primær | ✅ leses | ✅ leses | — |
| `AGENTS.md` | — | ✅ leses | ✅ primær | — |
| `GEMINI.md` | — | ✅ leses | — | ✅ primær |
| `.claude/rules/*.md` | ✅ auto-include | ✅ leses | — | — |
| `.claude/skills/` | ✅ native skills | ✅ leses | — | — |
| `.github/skills/` | — | ✅ native skills | — | — |
| `~/.copilot/skills/` | — | ✅ global skills | — | — |
| `.claude/commands/*.md` | ✅ slash commands | ✅ leses | — | — |
| `.claude/agents/*.md` | ✅ agents | ✅ leses | — | — |
| `.claude/settings.json` | ✅ MCP + hooks | — | — | — |
| `.github/copilot-instructions.md` | — | ✅ primær | — | — |
| `.github/instructions/**/*.instructions.md` | — | ✅ path-spesifikk | — | — |
| `~/.copilot/copilot-instructions.md` | — | ✅ global | — | — |
| `~/.codex/AGENTS.md` | — | — | ✅ global | — |
| `~/.codex/config.toml` | — | — | ✅ MCP | — |
| `.gemini/commands/*.toml` | — | — | — | ✅ slash commands |
| `~/.gemini/settings.json` | — | — | — | ✅ MCP |
| `.vscode/tasks.json` | — | ✅ tasks | — | — |

> ⚠️ **Copilot `.claude/*`-radene trenger re-verifisering.** Copilot CLI sluttet
> å laste agents/skills/commands fra `~/.claude/`. Om og hvordan prosjekt-nivå `.claude/`
> fortsatt leses er ikke bekreftet — se [Åpne oppfølgingspunkter](#åpne-oppfølgingspunkter).

---

## Claude Code

**Versjon:** 2.1.150 | **Sist verifisert:** 2026-05-23

### Instruksjonsfiler (leses automatisk)

| Fil | Beskrivelse |
|-----|-------------|
| `CLAUDE.md` | Primær instruksjonsfil — leses ved oppstart |
| `~/.claude/CLAUDE.md` | Global instruksjonsfil (bruker-nivå) |
| `.claude/rules/*.md` | Regelfileer — **inkluderes automatisk** i kontekst |

### Konfigurasjon

| Fil | Beskrivelse |
|-----|-------------|
| `.claude/settings.json` | MCP-servere, hooks, tillatelser |
| `.claude/skills/*/SKILL.md` | Native skills (aktiveres av Claude automatisk) |
| `.claude/commands/*.md` | Slash commands (`/kommando`) |
| `.claude/agents/*.md` | Custom agents (kan kalles med Agent tool) |

### Features

- **Skills:** Aktiveres automatisk basert på kontekst i forespørselen
- **Slash commands:** Brukeren skriver `/kommando`, Claude utfører
- **Agents:** Spesialiserte sub-agenter for parallelle oppgaver
- **MCP:** Støtte for MCP-servere via `settings.json`
- **Hooks:** Pre/post-hooks for tool calls via `settings.json`
- **Auto-apply edits:** Kan konfigureres til å skrive filer uten bekreftelse

### Implementasjon

```text
implementations/claude-code/
├── INSTALL.md
├── setup.sh
└── config/project/.claude/     ← kopieres til målprosjekt
```

---

## GitHub Copilot

**Versjon:** Copilot CLI v1.0.51 | **Sist verifisert:** 2026-05-23

### Instruksjonsfiler (leses automatisk)

| Fil | Beskrivelse |
|-----|-------------|
| `.github/copilot-instructions.md` | Repository-wide instruksjoner — primær |
| `.github/instructions/**/*.instructions.md` | Path-spesifikke instruksjoner |
| `~/.copilot/copilot-instructions.md` | Globale brukerinstruksjoner |
| `CLAUDE.md` | Leses også (kompatibilitet med Claude Code) |
| `AGENTS.md` | Leses også |
| `GEMINI.md` | Leses også |

**Viktig:** Copilot leser i tillegg `.claude/`-strukturen:

> ⚠️ **Trenger re-verifisering.** Copilot CLI sluttet å laste agents/skills/commands
> fra `~/.claude/`. Copilot-strategien under — og «KRITISK»-blokken lenger ned — antar at Copilot leser
> `.claude/`. Bekreft mot Copilot CLI v1.0.51 før neste install. Se [Åpne oppfølgingspunkter](#åpne-oppfølgingspunkter).

| Fil | Beskrivelse |
|-----|-------------|
| `.claude/skills/` | Agent skills — leses automatisk (samme format som Claude Code) |
| `.claude/commands/*.md` | Slash commands — leses av Copilot CLI |
| `.claude/agents/*.md` | Custom agents — leses av Copilot CLI |
| `.claude/rules/*.md` | Regelfileer — leses av Copilot CLI |

**Skills (native Copilot-plasseringer):**

| Fil | Beskrivelse |
|-----|-------------|
| `.github/skills/*/SKILL.md` | Repo-spesifikke skills (Copilots native plassering) |
| `~/.copilot/skills/*/SKILL.md` | Globale skills (deles på tvers av prosjekter) |

Siden vi allerede har skills i `.claude/skills/` plukker Copilot dem opp automatisk — vi trenger ikke duplisere til `.github/skills/`.

### Konfigurasjon

| Fil | Beskrivelse |
|-----|-------------|
| `.vscode/tasks.json` | VS Code tasks (tilgjengelig via Command Palette) |

### Features

- **Slash commands** — leser delte skills fra `~/.claude/skills/` (f.eks. `/aide-create`)
- **VS Code tasks** — forhåndsdefinerte oppgaver i Command Palette
- **Agent Mode** — kan utføre flerstegs workflows autonomt
- **MCP:** Støtte via GitHub MCP-server

### Installasjon til målprosjekter

`install.sh` installerer globalt — `AGENTS.md` blir til `~/.copilot/copilot-instructions.md`,
og felles scripts havner i `~/.local/bin/`. Skills deles via `~/.claude/skills/`, som
Copilot leser automatisk. Prosjektene trenger derfor ingen egen Copilot-konfig.

### Implementasjon

```text
implementations/copilot/
├── install.sh / uninstall.sh ← installerer core/AGENTS.md → ~/.copilot/copilot-instructions.md
├── .vscode/tasks.json        ← VS Code tasks
└── jetbrains/                ← JetBrains live templates

(Instruksjonsfilen genereres til core/AGENTS.md av core/scripts/build-agents-md.sh)
```

---

## Codex CLI

**Versjon:** 0.133.0 | **Sist verifisert:** 2026-05-23

### Instruksjonsfiler (leses automatisk)

| Fil | Beskrivelse |
|-----|-------------|
| `AGENTS.md` (`~/.codex/AGENTS.md`) | Primær instruksjonsfil (installeres fra `core/AGENTS.md`) |
| `CLAUDE.md` | Leses også |

### Konfigurasjon

| Fil | Beskrivelse |
|-----|-------------|
| `~/.codex/config.toml` | Global konfig: execPolicy, MCP-servere |

### Features

- **Ingen native slash commands** — bruker `codex-aide-*`-wrappers
- **CLI-wrappers** i `scripts/codex-aide-*` for vanlige arbeidsflyter
- **MCP:** Støtte via `~/.codex/config.toml`
- **Parallell kjøring** — kan jobbe på flere oppgaver samtidig

### Implementasjon

```text
implementations/codex/
├── config.toml                 ← sandbox + MCP
├── install.sh / uninstall.sh   ← global install: ~/.codex/AGENTS.md + wrappers
└── scripts/codex-aide-*        ← CLI-wrappers
```

---

## Gemini CLI

**Versjon:** 0.43.0 | **Sist verifisert:** 2026-05-23

### Instruksjonsfiler (leses automatisk)

| Fil | Beskrivelse |
|-----|-------------|
| `GEMINI.md` (`~/.gemini/GEMINI.md`) | Primær instruksjonsfil (installeres fra `core/AGENTS.md`) |

### Konfigurasjon

| Fil | Beskrivelse |
|-----|-------------|
| `~/.gemini/commands/*.toml` | Slash commands (TOML-format) |
| `~/.gemini/settings.json` | Global konfig: MCP-servere, tema |

### Features

- **Slash commands** via `.toml`-filer (ligner Claude Code, men TOML-format)
- **1M token kontekstvindu** — størst av alle verktøyene
- **Google Search grounding** — kan søke på nett
- **MCP:** Støtte via `~/.gemini/settings.json`
- **Generøs gratis kvote:** 60 req/min, 1000 req/dag

### Implementasjon

```text
implementations/gemini/
├── install.sh / uninstall.sh   ← global install: ~/.gemini/GEMINI.md + commands
├── settings.json               ← Gemini-konfig (MCP)
├── .gemini/commands/*.toml     ← slash commands
└── mcp/                        ← MCP-setup-docs
```

(GEMINI.md kommer fra core/AGENTS.md — install.sh kopierer den til ~/.gemini/GEMINI.md)

---

## Installasjon til målprosjekter

Når du installerer doc-aide i et målprosjekt (f.eks. my-app):

### Minimumskrav per verktøy

| Verktøy | Påkrevde filer |
|---------|----------------|
| Claude Code | `.claude/` (commands, rules, agents, skills), `CLAUDE.md` |
| Copilot | `.github/copilot-instructions.md` **og** `.claude/` (commands, rules, agents) |
| Codex | `~/.codex/AGENTS.md` (fra `core/AGENTS.md`) |
| Gemini | `GEMINI.md`, `.gemini/commands/` |

### Automatisert installasjon

```bash
# Claude Code
implementations/claude-code/setup.sh

# Copilot
implementations/copilot/install.sh

# Codex
implementations/codex/install.sh (hvis finnes)

# Gemini
implementations/gemini/install.sh (hvis finnes)
```

---

## Offisielle kilder

Sjekk disse når du oppdaterer versjoner eller lurer på om noe har endret seg:

### Claude Code

- [Claude Code dokumentasjon](https://docs.anthropic.com/en/docs/claude-code/overview)
- [Claude Code settings (CLAUDE.md, rules, skills, MCP)](https://docs.anthropic.com/en/docs/claude-code/settings)
- [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills)

### GitHub Copilot

- [Custom instructions — alle støttede filtyper](https://docs.github.com/en/copilot/reference/custom-instructions-support)
- [Repository-instruksjoner (.github/copilot-instructions.md)](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)
- [Agent skills (.github/skills/, .claude/skills/)](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills)
- [Changelog: Copilot støtter agent skills (2025-12-18)](https://github.blog/changelog/2025-12-18-github-copilot-now-supports-agent-skills/)

### Codex CLI

- [Codex CLI — GitHub repo og README](https://github.com/openai/codex)

### Gemini CLI

- [Gemini CLI — GitHub repo og README](https://github.com/google-gemini/gemini-cli)

---

## Se også

- [AI_NYHETSLOGG.md](./AI_NYHETSLOGG.md) — Nyhetslogg / research-feed som mater denne matrisen
- [AI_DEVELOPMENT_GUIDE.md](./AI_DEVELOPMENT_GUIDE.md) — Arkitektur og design patterns
- [implementations/claude-code/](../implementations/claude-code/) — Claude Code-implementasjon
- [implementations/copilot/](../implementations/copilot/) — Copilot-implementasjon
- [implementations/codex/](../implementations/codex/) — Codex-implementasjon
- [implementations/gemini/](../implementations/gemini/) — Gemini-implementasjon
