# GitHub Copilot - Implementasjonsguide

## Innholdsfortegnelse

- [Oversikt](#oversikt)
- [Quick Start](#quick-start)
- [Hva er Agent Mode?](#hva-er-agent-mode)
- [Forutsetninger](#forutsetninger)
- [Installasjon](#installasjon)
- [Konfigurasjon](#konfigurasjon)
- [Bruk](#bruk)
  - [Slash commands i Copilot CLI](#slash-commands-i-copilot-cli)
  - [JIRA-arbeidsflyt](#jira-arbeidsflyt)
  - [TDD-arbeidsflyt](#tdd-arbeidsflyt)
- [Tips og triks](#tips-og-triks)
- [Begrensninger](#begrensninger)
- [Sammenligning med Claude Code](#sammenligning-med-claude-code)
  - [Tilgjengelige modeller](#tilgjengelige-modeller)
  - [Når bruke hva?](#når-bruke-hva)

---

## Oversikt

Denne implementasjonen lar deg bruke **GitHub Copilot CLI** — som ble [GA 25. februar 2026](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/) — og **Copilot Agent Mode i VS Code** til å følge samme workflows som Claude Code.

**Copilot CLI** er en terminal-nativ kodingsagent med native slash commands, plan mode, autopilot mode og permanent permissions-konfigurasjon. Den leser **CLAUDE.md** og `.github/copilot-instructions.md` direkte, noe som gjør oppsettet enklere enn i preview-perioden.

**Arkitektur:**

```text
implementations/copilot/
├── README.md                           # Denne filen
├── INSTALL.md                          # Detaljert installasjonsveiledning
├── install.sh                          # Installasjonsscript (kjørbar)
├── uninstall.sh                        # Avinstallasjonsscript (kjørbar)
└── jetbrains/                          # Live Templates for JetBrains-IDEer
```

**Gjenbruker:**

- ✅ `core/AGENTS.md` - Generert instruksjonsfil (intro + core/rules/, deles med Codex)
- ✅ `core/rules/` - Samme workflows, git-regler, testing-regler
- ✅ `core/templates/` - Samme 4-fils dokumentstruktur
- ✅ `core/scripts/` - Samme scripts (aide-generate-pdf, etc.)
- ✅ `implementations/claude-code/rules/` - Felles regler (git, testing, workflows, dokumentasjon)

---

## Quick Start

**Første gang?** Følg installasjonsveiledningen:

```bash
# 1. Les detaljert installasjonsveiledning
cat implementations/copilot/INSTALL.md

# 2. Kjør install-script
cd implementations/copilot
./install.sh
```

**Allerede installert?** Hopp til [Bruk](#bruk).

---

## Hva er Agent Mode?

**Agent Mode** er GitHub Copilot's autonome modus som kan:
- ✅ Analysere hele kodebasen for kontekst
- ✅ Planlegge og utføre multi-step løsninger
- ✅ Kjøre kommandoer og tester
- ✅ Iterere til løsningen er riktig (RED → GREEN → REFACTOR)
- ✅ Auto-fikse feil underveis

**Forskjell fra vanlig Copilot:**
- Vanlig Copilot: Linje-for-linje code completion
- Agent Mode: Autonome multi-step oppgaver

---

## Forutsetninger

### 1. GitHub Copilot-abonnement

- GitHub Copilot Individual, Business, Pro eller Enterprise
- Copilot CLI er tilgjengelig for alle abonnementer

### 2. Copilot CLI (terminal)

```bash
# Installer via npm (anbefalt)
npm install -g @github/copilot

# Eller via Homebrew
brew install copilot-cli

# Eller via curl
curl -fsSL https://gh.io/copilot-install | bash
```

### 3. VS Code med utvidelser (valgfritt, for Agent Mode i IDE)

```bash
# Installer VS Code-utvidelser
code --install-extension GitHub.copilot
code --install-extension GitHub.copilot-chat
```

---

## Installasjon

### Steg 1: Installer custom instructions

Kjør install-scriptet — det installerer `AGENTS.md` som global Copilot-instruksjon
i `~/.copilot/copilot-instructions.md`:

```bash
cd implementations/copilot
./install.sh
```

Copilot CLI leser i tillegg **CLAUDE.md** direkte fra prosjektroten.

### Steg 2: Velg modell og modus

**Copilot CLI:**

```bash
# Start Copilot CLI
copilot

# Velg modell (i interaktiv sesjon)
/model
```

**VS Code Agent Mode:**

1. Åpne Copilot Chat i VS Code
2. Velg **"agent"** fra chat mode dropdown
3. Konfigurer verktøy via tools-knappen
4. Velg foretrukket AI-modell

---

## Konfigurasjon

### Custom Instructions

Install-scriptet legger `AGENTS.md` som global instruksjon i `~/.copilot/copilot-instructions.md`. Den inneholder:

- 🎯 Workspace-konsept og struktur
- 📋 Referanser til `core/rules/workflows.md`
- 🧪 TDD-regler fra `core/rules/testing.md`
- 🔀 Git-regler fra `core/rules/git.md`
- 📝 Dokumentstandard fra `core/rules/documentation.md`

Copilot vil automatisk følge disse reglene når du ber om hjelp.

---

## Bruk

### Slash commands i Copilot CLI

Copilot CLI leser de samme skills som Claude Code (fra `~/.claude/skills/` og
`~/.claude/commands/`), så slash commands virker **native** — ingen oppsett ut
over `install.sh`:

| Kommando | Funksjon |
|----------|----------|
| `/aide-create` | Opprett JIRA-dokumentasjon |
| `/aide-analyze` | Analyser kodebase |
| `/aide-implement` | Implementer med TDD |
| `/aide-make-tests` | Lag tester for fil |
| `/aide-react-class-to-func` | Konverter React class til functional |

Skriv kommandoen i en `copilot`-sesjon, akkurat som i Claude Code.

---

### JetBrains IDE (IntelliJ, WebStorm, etc.)

For JetBrains IDE-er bruker vi **Live Templates** som ekspanderer til fulle prompts.

**Installasjon:**

Setup-scriptet installerer automatisk til alle JetBrains IDE-er, eller manuelt:

```bash
cp implementations/copilot/jetbrains/aide-templates.xml \
   ~/Library/Application\ Support/JetBrains/<IDE>/templates/
```

**Bruk:**

1. Åpne en scratch-fil eller kodefil (Live Templates fungerer kun i editoren)
2. Skriv forkortelsen (f.eks. `aide-review`) og trykk `Tab`
3. Prompten ekspanderes
4. Kopier teksten og lim inn i Copilot Chat (Tools → GitHub Copilot → Chat)

**Merk:** JetBrains Copilot Chat støtter ikke direkte shortcuts som VS Code, så dette er en workaround.

**Tilgjengelige templates:**

| Forkortelse              | Funksjon                             |
|--------------------------|--------------------------------------|
| `aide-review`            | Code review før PR                   |
| `aide-create`           | Opprett JIRA-dokumentasjon           |
| `aide-analyze`          | Analyser kodebase                    |
| `aide-implement`               | Implementer med TDD                  |
| `aide-make-tests`        | Lag manglende tester                 |
| `aide-react-class-to-func` | Konverter React class til functional |

---

### JIRA-arbeidsflyt

#### 1. Opprett JIRA-dokumentasjon

**I stedet for:** `/aide-create PROJ-7890` (Claude Code)

**Med Copilot (Agent Mode):**

```text
Opprett strukturert dokumentasjon for JIRA-sak PROJ-7890:

1. Opprett katalog: reports/<NN>-PROJ-7890-slug/
2. Følg core/rules/documentation.md
3. Bruk templates fra core/templates/todo/
4. Fyll ut 1-description.md med JIRA-metadata (bruker limer inn data)
5. Opprett tomme filer: 2-analysis.md, 3-solution.md, 4-status.md
6. Stage alle nye filer i git
```

#### 2. Analyser kodebase

**I stedet for:** `/aide-analyze PROJ-7890` (Claude Code)

**Med Copilot (Agent Mode):**

```text
Analyser kodebasen for JIRA-sak PROJ-7890:

1. Les reports/<NN>-PROJ-7890-slug/1-description.md
2. Søk i kodebasen etter relevante filer
3. Identifiser påvirkede komponenter (fil:linje)
4. Sjekk API-påvirkning (frontend ↔ backend)
5. Vurder kompleksitet (enkel/middels/kompleks)
6. Oppdater 2-analysis.md med funn
7. Lag implementeringsplan i 3-solution.md
8. Følg core/rules/workflows.md struktur
```

#### 3. Implementer med TDD

**I stedet for:** `/aide-implement PROJ-7890` (Claude Code)

**Med Copilot (Agent Mode):**

```text
Implementer løsningen for PROJ-7890 med TDD:

RED PHASE:
1. Les 3-solution.md → Steg 0: Skriv tester
2. Opprett testfiler som beskrevet
3. Kjør: pnpm test -- --run <testfil>
4. Verifiser at tester FEILER
5. Stopp og be om bekreftelse

GREEN PHASE:
1. Implementer Steg 1-N fra 3-solution.md
2. Kjør tester etter hvert steg
3. Verifiser at alle tester PASSERER
4. Stopp og be om bekreftelse

REFACTOR PHASE:
1. Kjør: pnpm test -- --run (alle tester)
2. Kjør: npx tsc --noEmit
3. Kjør: pnpm run eslint
4. Oppdater 4-status.md med resultat

Følg prosjektets kodestandard for all kode.
```

### TDD-arbeidsflyt

Copilot's Agent Mode har innebygd støtte for TDD-syklusen:
- Skriver tester først (RED)
- Implementerer til tester passerer (GREEN)
- Refaktorerer og verifiserer (REFACTOR)
- Itererer automatisk ved feil

---

---

## Tips og triks

### 1. Vær eksplisitt om kontekst

❌ **Dårlig:**
```text
Analyser PROJ-7890
```

✅ **Bra:**
```text
Analyser PROJ-7890 ved å følge core/rules/workflows.md.
Les først 1-description.md, søk deretter i kodebasen,
og oppdater 2-analysis.md med funn (fil:linje).
```

### 2. Referer alltid til core/rules/

```text
Følg workflows i core/rules/workflows.md
Følg git-regler i core/rules/git.md
Følg testing-regler i core/rules/testing.md
Følg prosjektets kodestandarder
```

### 3. Be om steg-for-steg

```text
Gjør dette steg-for-steg. Stopp etter hver fase og be om bekreftelse:
1. RED phase → Stopp
2. GREEN phase → Stopp
3. REFACTOR phase → Stopp
```

### 4. Bruk checkpoint-prompts

```text
Status-sjekk:
- Har du lest core/rules/workflows.md?
- Har du fulgt 4-fils struktur?
- Har du kjørt testene?
- Har du oppdatert status.md?
```

### 5. Verifiser forståelse

```text
Før du starter: Oppsummer hva du skal gjøre.
Inkluder hvilke filer som skal endres og hvilke tester som skal skrives.
```

---

## Begrensninger

### Permission prompts

Copilot CLI spør om tillatelse for fil-operasjoner og kommandokjøring.

**Løsninger:**

```bash
# Godkjenn alt for sesjon (interaktivt)
# Velg: "Yes, and approve all file operations for the rest of the running session"

# Eller bruk CLI-flagg ved oppstart
copilot --allow-all-tools                 # Tillat alle verktøy
copilot --allow-tool 'shell(git)'         # Tillat spesifikke verktøy
copilot --allow-all-paths                 # Tillat alle filstier

# Full automatisering (kun i isolerte miljøer)
copilot --yolo                            # Tillat alt uten spørsmål
```

**Permanent konfigurasjon:** Bruk `~/.copilot/config.json` med `trusted_folders` for å forhåndsgodkjenne kataloger.

---

### Copilot CLI HAR:

- ✅ Native slash commands (`/model`, `/diff`, `/plugin install`, m.fl.)
- ✅ Automatisk lesing av **CLAUDE.md** fra prosjektroten
- ✅ Automatisk lesing av `.github/copilot-instructions.md`
- ✅ Path-spesifikke instruksjoner (`.github/instructions/*.instructions.md`)
- ✅ Plan mode (Shift+Tab for å bytte modus)
- ✅ Autopilot mode (full autonomi uten bekreftelser)
- ✅ Spesialiserte agenter (Explore, Task, Code Review, Plan)
- ✅ Agent Mode for autonome multi-step oppgaver
- ✅ Codebase analysis
- ✅ Command execution
- ✅ Test iteration (RED → GREEN → REFACTOR)
- ✅ Tool calling (kan kjøre Python scripts)
- ✅ MCP server-støtte (innebygd GitHub MCP + custom)
- ✅ Permanent permissions via `config.json` og CLI-flagg

### Copilot CLI har IKKE:

- ❌ Innebygde agents som `@agent-jira-analyzer` (bruker generelle agenter)

---

## Sammenligning med Claude Code

| Feature | Claude Code | Copilot CLI |
|---------|-------------|-------------|
| **Kommandoer** | Slash commands (`/aide-create`) | Slash commands + natural language |
| **Instruksjoner** | CLAUDE.md (auto-read) | CLAUDE.md + copilot-instructions.md |
| **Plan mode** | ✅ Native | ✅ Native (Shift+Tab) |
| **Autopilot mode** | ✅ (via permissions) | ✅ Native (`--yolo`) |
| **Agents** | `@agent-jira-analyzer` | Spesialiserte (Explore, Task, Code Review) |
| **Skills** | ✅ `.claude/skills/` | ✅ Leser `~/.claude/commands/` + `.claude/skills/` |
| **TDD** | Innebygd RED→GREEN→REFACTOR | Agent Mode itererer |
| **Codebase analysis** | ✅ | ✅ |
| **Tool calling** | ✅ | ✅ |
| **MCP servers** | ✅ | ✅ (innebygd GitHub MCP) |
| **Permanent permissions** | ✅ `settings.json` | ✅ `config.json` + CLI-flagg |
| **Multi-step autonomy** | ✅ | ✅ |
| **Modeller** | Claude Opus/Sonnet/Haiku | Claude, GPT, Gemini (valgfritt) |
| **Context window** | 200K tokens | Varierer med modell |
| **IDE-integrasjon** | VS Code (via CLI) | VS Code (native) + CLI |

### Tilgjengelige modeller

| Modell | Claude Code | Copilot CLI |
|--------|-------------|-------------|
| Claude Opus 4.7 | ✅ | ✅ |
| Claude Sonnet 4.6 | ✅ | ✅ |
| Claude Haiku 4.5 | ✅ | ✅ |
| GPT-5.5 | ❌ | ✅ |
| Gemini 3.x | ❌ | ✅ |

### Når bruke hva?

| Scenario | Anbefaling |
|----------|-----------|
| **Kompleks JIRA-analyse** | Claude Code (bedre skills/agents) |
| **Quick edits** | Copilot (raskere i VS Code) |
| **TDD-implementering** | Begge fungerer godt |
| **Refaktorering** | Copilot (native VS Code-integrasjon) |
| **Tverrfaglige saker** | Claude Code (bedre multi-repo støtte) |
| **Full automatisering** | Copilot CLI (`--yolo` modus) |

---

## Neste steg

1. ✅ Installer Copilot og aktiver Agent Mode
2. ✅ Kopier custom instructions
3. ✅ Test med en enkel JIRA-sak

---

## Headless Mode (Copilot CLI)

Copilot CLI støtter headless mode for automatisering og scripting.

### Grunnleggende bruk

```bash
# Kjør enkelt prompt uten interaktiv UI
copilot -p "Analyser denne koden"

# Tillat alle verktøy (for full automatisering)
copilot -p "Kjør alle tester" --allow-all-tools

# Tillat spesifikke verktøy
copilot -p "Revert siste commit" --allow-tool 'shell(git)'

# Full automatisering (isolerte miljøer)
copilot -p "Kjør alle tester og fiks feil" --yolo
```

### E2E Testing

```bash
# Test at Copilot CLI fungerer
copilot -p "Si 'hello'"

# Kjør aide-workflow headless
copilot -p "/aide-create PROJ-TEST"
```

### Flagg-referanse

| Flagg | Beskrivelse |
|-------|-------------|
| `-p "prompt"` | Headless/programmatic mode |
| `--allow-all-tools` | Tillat alle verktøy uten bekreftelse |
| `--allow-tool 'tool'` | Tillat spesifikt verktøy |
| `--deny-tool 'tool'` | Blokker spesifikt verktøy |
| `--allow-all-paths` | Tillat tilgang til alle filstier |
| `--allow-all-urls` | Tillat tilgang til alle URL-er |
| `--allow-url <domain>` | Forhåndsgodkjenn spesifikt domene |
| `--yolo` / `--allow-all` | Tillat alt uten bekreftelse |

**Sikkerhet:** Bruk `--yolo` / `--allow-all-tools` kun i isolerte miljøer (containere, VM).

### Slash commands i CLI

| Kommando | Beskrivelse |
|----------|-------------|
| `/model` | Bytt modell midt i sesjonen |
| `/diff` | Se alle endringer i sesjonen med syntax-highlighting |
| `/plugin install owner/repo` | Installer plugins fra GitHub |
| `/login` | Autentisering |
| `/lsp` | Vis LSP server-status |
| `/feedback` | Send tilbakemelding |

---

## Ressurser

**Offisiell dokumentasjon og best practices:**

- [GitHub Copilot Documentation](https://docs.github.com/en/copilot) - Fullstendig dokumentasjon
- [Copilot Best Practices](https://docs.github.com/en/copilot/using-github-copilot/best-practices-for-using-github-copilot) - Offisielle best practices
- [Prompt Engineering for Copilot](https://docs.github.com/en/copilot/using-github-copilot/prompt-engineering-for-github-copilot) - Prompt-teknikker

**Copilot CLI:**

- [Copilot CLI GitHub repo](https://github.com/github/copilot-cli) - Open source repo
- [Using Copilot CLI - GitHub Docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli) - CLI-dokumentasjon
- [Configure Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli) - Konfigurasjon
- [Custom Instructions for CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions) - CLAUDE.md og instruksjoner
- [GA-annonsering (25. feb 2026)](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/) - Changelog

---

**Lykke til med GitHub Copilot!**
