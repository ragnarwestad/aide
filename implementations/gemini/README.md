# Google Gemini CLI - Implementasjonsguide

## Innholdsfortegnelse

- [Oversikt](#oversikt)
- [Hva er Gemini CLI?](#hva-er-gemini-cli)
- [Forutsetninger](#forutsetninger)
- [Installasjon](#installasjon)
- [Konfigurasjon](#konfigurasjon)
  - [VS Code-integrasjon](#vs-code-integrasjon-gemini-code-assist)
- [Bruk](#bruk)
  - [Slash Commands](#slash-commands)
  - [JIRA-arbeidsflyt](#jira-arbeidsflyt)
  - [TDD-arbeidsflyt](#tdd-arbeidsflyt)
- [Slash Commands (detaljer)](#slash-commands)
- [Prompt-templates](#prompt-templates)
- [VS Code Tasks](#vs-code-tasks)
- [Tips og triks](#tips-og-triks)
- [Begrensninger](#begrensninger)
- [Sammenligning med Claude Code](#sammenligning-med-claude-code)

---

## Oversikt

Denne implementasjonen lar deg bruke **Google Gemini CLI** til å følge samme workflows som Claude Code, med terminal-basert AI-assistanse.

**Arkitektur:**
```text
implementations/gemini/
├── README.md                           # Denne filen
├── GEMINI.md                           # Custom instructions (kopieres til workspace)
└── .gemini/
    └── commands/                       # Slash commands (TOML-format)
        ├── aide-opprett.toml           # /aide-opprett
        ├── aide-analyser.toml          # /aide-analyser
        ├── aide-los.toml               # /aide-los
        ├── aide-lag-tester.toml        # /aide-lag-tester
        └── aide-react-class-to-func.toml # /aide-react-class-to-func
```

**Gjenbruker:**
- `core/rules/` - Samme workflows, git-regler, testing-regler
- `core/templates/` - Samme 4-fils dokumentstruktur
- `core/scripts/` - Samme scripts (aide-generate-pdf, etc.)

---

## Hva er Gemini CLI?

**Gemini CLI** er et open-source AI-verktøy fra Google som kan:
- Kjøre lokalt i terminalen med tilgang til filsystemet
- Navigere i repo, editere filer, kjøre kommandoer
- Bruke Google Search for oppdatert informasjon
- Integrere med MCP (Model Context Protocol) for utvidelser
- Lagre og gjenoppta samtaler (checkpointing)

**Modell:**
- Gemini 3 (default, 1M token context window)
- Gemini 3.x Flash / Flash-Lite for raskere/billigere bruk

**Gratis tier:**
- 60 requests/minutt
- 1000 requests/dag
- Gemini 3 med 1M token context window

**Open source:**
- Apache 2.0 lisens
- https://github.com/google-gemini/gemini-cli

---

## Forutsetninger

### 1. Google-konto

- Personlig Google-konto (gratis tier)
- Eller betalt tier (Google AI Pro/Ultra) for høyere grenser
- Eller betalt API-nøkkel

### 2. Node.js 20+

```bash
# Sjekk versjon
node --version
# Må være 20.x eller høyere
```

---

## Installasjon

### Steg 1: Installer Gemini CLI

```bash
# Via npm (anbefalt)
npm install -g @google/gemini-cli

# Via Homebrew (macOS)
brew install gemini-cli

# Eller kjør uten installasjon
npx https://github.com/google-gemini/gemini-cli
```

### Steg 2: Autentiser

```bash
# Start Gemini CLI - autentisering skjer automatisk
gemini

# Følg instruksjonene for å logge inn med Google-konto
```

### Steg 3: Kopier GEMINI.md til workspace

```bash
# Fra doc-aide workspace-roten
cp implementations/gemini/GEMINI.md ./GEMINI.md
```

Gemini CLI leser automatisk `GEMINI.md` i prosjekt-roten ved oppstart.

---

## Konfigurasjon

### GEMINI.md

Gemini CLI leser automatisk `GEMINI.md` som inneholder:

- Workspace-konsept og struktur
- Referanser til `core/rules/workflows.md`
- TDD-regler fra `core/rules/testing.md`
- Git-regler fra `core/rules/git.md`
- Dokumentstandard fra `core/rules/documentation.md`

### Miljøvariabler

```bash
# Legg til i ~/.bashrc eller ~/.zshrc
export AIDE_INSTALLATION_PATH="/Users/$(whoami)/develop/doc-aide"

# Valgfritt: Separat reports-path
export AIDE_REPORTS_PATH="/Users/$(whoami)/Documents/aide-reports"
```

### Global settings

Gemini CLI-innstillinger lagres i `~/.gemini/settings.json`:

```json
{
  "theme": "dark",
  "mcpServers": {}
}
```

### VS Code-integrasjon (Gemini Code Assist)

Som et alternativ til terminal-basert bruk kan du bruke **Gemini Code Assist** i VS Code. Dette gir deg tilgang til Gemini-funksjonalitet direkte i editoren.

**Installasjon:**

1. Åpne VS Code Extensions (`Cmd+Shift+X` / `Ctrl+Shift+X`)
2. Søk etter "Gemini Code Assist"
3. Installer extensionen fra Google
4. Logg inn med Google-konto

**Funksjoner i VS Code:**

| Funksjon | Terminal (Gemini CLI) | VS Code (Code Assist) |
|----------|----------------------|----------------------|
| Chat | ✅ Fullt funksjonelt | ✅ Sidebar chat |
| Slash commands | ✅ Native (`.toml`) | ❌ Ikke støttet |
| Fil-editing | ✅ Full tilgang | ✅ Inline suggestions |
| Terminal-kommandoer | ✅ Full tilgang | ⚠️ Begrenset |
| GEMINI.md | ✅ Auto-lest | ❌ Ikke lest |
| Context window | ✅ 1M tokens | ⚠️ Varierer |

**Anbefaling:**

- **Bruk Gemini CLI** for JIRA-workflows, TDD, og komplekse analyser
- **Bruk Code Assist** for inline code completion og raske spørsmål i VS Code

**Merk:** Gemini Code Assist agent mode i VS Code er "powered by Gemini CLI" og deler kvoter med terminal-versjonen.

---

## Bruk

### Slash Commands

Gemini CLI støtter slash commands via TOML-filer i `.gemini/commands/`.

**Tilgjengelige kommandoer:**

| Kommando | Beskrivelse |
|----------|-------------|
| `/aide-opprett <ID>` | Opprett dokumentstruktur for JIRA-sak eller TODO-plan |
| `/aide-analyser <ID>` | Analyser kodebase og identifiser påvirkede filer |
| `/aide-los <ID>` | Implementer løsning med TDD (RED-GREEN-REFACTOR) |
| `/aide-lag-tester <fil>` | Lag manglende enhetstester for en fil |
| `/aide-react-class-to-func <fil>` | Konverter React class til functional component |

**Bruk:**

```bash
# Start Gemini CLI
gemini

# Bruk slash commands
> /aide-opprett PROJ-7890
> /aide-analyser PROJ-7890
> /aide-los PROJ-7890

# TODO-arbeidsflyt
> /aide-opprett todo-01
> /aide-analyser todo-01
> /aide-los todo-01

# Utility-kommandoer
> /aide-lag-tester src/utils/land.ts
> /aide-react-class-to-func src/components/UserProfile.tsx
```

**Installasjon av slash commands:**

```bash
# Kopier .gemini/ katalogen til workspace-roten
cp -r implementations/gemini/.gemini ./
```

---

### JIRA-arbeidsflyt

#### 1. Opprett JIRA-dokumentasjon

**I stedet for:** `/aide-opprett PROJ-7890` (Claude Code)

**Med Gemini CLI:**

```bash
# Start interaktiv sesjon
gemini

# Deretter:
> Opprett strukturert dokumentasjon for JIRA-sak PROJ-7890:
>
> 1. Opprett katalog: reports/<NN>-PROJ-7890-slug/
> 2. Følg core/rules/documentation.md
> 3. Bruk templates fra core/templates/todo/
> 4. Fyll ut 1-beskrivelse.md med JIRA-metadata (bruker limer inn data)
> 5. Opprett tomme filer: 2-analyse.md, 3-løsning.md, 4-status.md
> 6. Stage alle nye filer i git
```

**Eller direkte fra terminal:**
```bash
gemini -p "Hent JIRA-sak PROJ-7890 og opprett dokumentasjon"
```

#### 2. Analyser kodebase

**I stedet for:** `/aide-analyser PROJ-7890` (Claude Code)

**Med Gemini CLI:**

```bash
gemini -p "Analyser kodebasen for JIRA-sak PROJ-7890:

1. Les reports/<NN>-PROJ-7890-slug/1-beskrivelse.md
2. Søk i kodebasen etter relevante filer
3. Identifiser påvirkede komponenter (fil:linje)
4. Sjekk API-påvirkning (frontend ↔ backend)
5. Vurder kompleksitet (enkel/middels/kompleks)
6. Oppdater 2-analyse.md med funn
7. Lag implementeringsplan i 3-løsning.md
8. Følg core/rules/workflows.md struktur"
```

#### 3. Implementer med TDD

**I stedet for:** `/aide-løs PROJ-7890` (Claude Code)

**Med Gemini CLI:**

```bash
gemini -p "Implementer løsningen for PROJ-7890 med TDD:

RED PHASE:
1. Les 3-løsning.md -> Steg 0: Skriv tester
2. Opprett testfiler som beskrevet
3. Kjør: pnpm test -- --run <testfil>
4. Verifiser at tester FEILER
5. Stopp og be om bekreftelse

GREEN PHASE:
1. Implementer Steg 1-N fra 3-løsning.md
2. Kjør tester etter hvert steg
3. Verifiser at alle tester PASSERER
4. Stopp og be om bekreftelse

REFACTOR PHASE:
1. Kjør: pnpm test -- --run (alle tester)
2. Kjør: npx tsc --noEmit
3. Kjør: pnpm run eslint
4. Oppdater 4-status.md med resultat

Følg prosjektets kodestandard for all kode."
```

### TDD-arbeidsflyt

Gemini CLI støtter TDD-syklusen:
- Skriver tester først (RED)
- Implementerer til tester passerer (GREEN)
- Refaktorerer og verifiserer (REFACTOR)
- Itererer automatisk ved feil

---

## Prompt-templates

Slash commands ligger i `.gemini/commands/*.toml` og virker native i en `gemini`-sesjon:

| Kommando | Formål |
|----------|--------|
| `/aide-opprett` | Opprett JIRA/TODO-dokumentasjon |
| `/aide-analyser` | Analyser kodebase |
| `/aide-los` | Implementer med TDD |
| `/aide-lag-tester` | Lag manglende enhetstester |
| `/aide-react-class-to-func` | Konverter class til functional |

**Bruk:**
```bash
# I en gemini-sesjon:
/aide-opprett PROJ-7890
```

---

## VS Code Tasks

VS Code Tasks gjør det enkelt å starte Gemini-workflows direkte fra VS Code.

**Tilgjengelige tasks:**

| Task | Beskrivelse |
|------|-------------|
| `Gemini: Start interaktiv sesjon` | Åpne Gemini CLI i terminal |
| `Gemini: Opprett JIRA-dokumentasjon` | Opprett 4-fils struktur for JIRA-sak |
| `Gemini: Analyser kodebase` | Analyser påvirkede filer |
| `Gemini: Implementer med TDD` | Implementer med RED-GREEN-REFACTOR |

**Bruk:**

1. Åpne Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Velg "Tasks: Run Task"
3. Velg ønsket Gemini-task
4. Skriv inn JIRA-ID når du blir spurt

**Alternativt:** Bruk `Cmd+Shift+B` / `Ctrl+Shift+B` for å kjøre build tasks.

---

## Tips og triks

### 1. Bruk Google Search grounding

Gemini CLI kan søke på nettet for oppdatert informasjon:

```bash
gemini -p "Søk etter beste praksis for React 19 hooks og oppsummer"
```

### 2. Inkluder flere kataloger

```bash
gemini --include-directories ../my-api,../my-app
```

### 3. Lagre og gjenoppta samtaler

```bash
# Gemini lagrer automatisk samtaler
# Bruk /chat for å administrere

gemini
> /chat list      # Vis tidligere samtaler
> /chat load 123  # Last inn samtale
```

### 4. Bruk MCP-servere

Konfigurer MCP-servere i `~/.gemini/settings.json` for utvidede funksjoner.

### 5. Vær eksplisitt om kontekst

**Dårlig:**
```bash
gemini -p "Analyser PROJ-7890"
```

**Bra:**
```bash
gemini -p "Analyser PROJ-7890 ved å følge core/rules/workflows.md.
Les først 1-beskrivelse.md, søk deretter i kodebasen,
og oppdater 2-analyse.md med funn (fil:linje)."
```

---

## Begrensninger

### Gemini CLI har IKKE:

- Innebygde agents som `@agent-jira-analyzer` (men du kan bruke slash commands)
- IDE-integrasjon på samme nivå som Copilot

### Gemini CLI HAR:

- Terminal-basert CLI (open source)
- Google Search grounding
- MCP-støtte for utvidelser
- Conversation checkpointing
- 1M token context window (gratis)
- Multimodal støtte (bilder, etc.)

### Kostnader:

- **Gratis tier:** 60 req/min, 1000 req/dag
- **API:** Priser varierer, se Google AI Studio
- **Google AI Pro/Ultra:** Høyere grenser og tilgang til toppmodeller

### Workarounds:

1. **Slash commands:** Bruk `.gemini/commands/` (TOML-filer)
2. **Auto-read CLAUDE.md - GEMINI.md:** Konfigurer `GEMINI.md` i prosjekt-roten
3. **Agents - Explicit prompts:** Be Gemini om å følge spesifikke workflows

---

## Sammenligning med Claude Code

| Feature | Claude Code | Gemini CLI |
|---------|-------------|------------|
| **Kommandoer** | Slash commands (`.md`) | Slash commands (`.toml`) |
| **Instruksjoner** | CLAUDE.md (auto-read) | GEMINI.md (auto-read) |
| **Agents** | `@agent-jira-analyzer` | Slash commands |
| **TDD** | Innebygd RED-GREEN-REFACTOR | Støtter TDD-syklus |
| **Codebase analysis** | Ja | Ja |
| **Tool calling** | Ja | Ja |
| **Web search** | Nei | Ja (Google Search) |
| **MCP-støtte** | Ja | Ja |
| **Context window** | 200K tokens | 1M tokens |
| **Open source** | Nei | Ja (Apache 2.0) |
| **Pris** | Begrenset gratis | Sjenerøs gratis tier |

### Når bruke hva?

| Scenario | Anbefaling |
|----------|-----------|
| **Stor kontekst (mange filer)** | Gemini CLI (1M tokens) |
| **Oppdatert web-info** | Gemini CLI (Google Search) |
| **Slash commands workflow** | Claude Code |
| **Open source preferanse** | Gemini CLI |
| **TDD-implementering** | Begge fungerer godt |
| **IDE-integrasjon** | Claude Code / Copilot |

---

## Neste steg

1. Installer Gemini CLI
2. Autentiser med Google-konto
3. Kopier GEMINI.md til workspace
4. Test med en enkel JIRA-sak

---

## Headless Mode (Automatisering)

Gemini CLI støtter headless mode for automatisering, CI/CD og scripting.

### Grunnleggende bruk

```bash
# Kjør enkelt prompt uten interaktiv UI
gemini -p "Analyser denne koden og foreslå forbedringer"

# Med JSON output for programmatisk parsing
gemini -p "List alle TypeScript-filer i src/" -o json

# YOLO mode - ingen bekreftelser (full automatisering)
gemini -p "Kjør alle tester" -y
```

### E2E Testing

```bash
# Test at Gemini CLI fungerer
gemini -p "Si 'hello'" -o json

# Kjør aide-workflow headless
gemini -p "/aide-opprett PROJ-TEST" -y
```

### Flagg for automatisering

| Flagg | Beskrivelse |
|-------|-------------|
| `-p "prompt"` | Headless mode - kjør uten interaktiv UI |
| `-o json` | JSON output for parsing |
| `-y` / `--yolo` | Ingen bekreftelser (full automatisering) |

**Merk:** Custom commands (`.toml`) har begrenset støtte i headless mode per nå.

---

## Ressurser

**Offisiell dokumentasjon:**

- [Gemini CLI GitHub](https://github.com/google-gemini/gemini-cli) - Open source repo
- [Google Developers - Gemini CLI](https://developers.google.com/gemini-code-assist/docs/gemini-cli) - Offisiell dokumentasjon
- [Gemini CLI Hands-on Codelab](https://codelabs.developers.google.com/gemini-cli-hands-on) - Interaktiv tutorial

**Headless mode og automatisering:**

- [Headless Mode - Gemini CLI Docs](https://google-gemini.github.io/gemini-cli/docs/cli/headless.html) - Offisiell headless-dokumentasjon

---

**Lykke til med Gemini CLI!**
