# COPILOT.md

Denne filen er inngangsporten til GitHub Copilot når du jobber i dette repositoriet.

**📍 Deployment:** Denne filen er for mennesker som skal sette opp VS Code med Copilot.

## 📍 Hvor du er nå

Du er i **doc-aide**. Dette er et AI-verktøy workspace for AI-assistert utvikling.

---

## 🚀 Oppsett for GitHub Copilot

### 1. Installer VS Code extensions

Åpne workspace i VS Code - du vil få forslag om å installere anbefalte extensions (`.vscode/extensions.json`):
- GitHub Copilot
- GitHub Copilot Chat
- Markdown linting
- ESLint, Prettier, Python

### 2. Workspace Trust

Første gang du åpner workspace i VS Code:
1. Klikk "Trust Workspace" (kreves for at tasks skal fungere)
2. Dette gir Copilot tilgang til alle filer i workspace

### 3. Verifiser konfigurasjon

**Sjekk at custom instructions lastes:**
1. Åpne Copilot Chat (`Cmd+Shift+I` / `Ctrl+Shift+I`)
2. Klikk på "..." → "Settings"
3. Verifiser at `.github/copilot-instructions.md` er listet under "Instructions"

**Sjekk environment variabler:**
```bash
# I VS Code terminal (Ctrl+` / Cmd+`)
echo $AIDE_INSTALLATION_PATH
# Skal printe: /Users/[din-bruker]/develop/doc-aide

echo $PATH | grep ".local/bin"
# Skal inneholde: ~/.local/bin
```

### 4. Test tasks

**Kjør en task:**
1. `Cmd+Shift+P` / `Ctrl+Shift+P` → "Tasks: Run Task"
2. Velg en task (f.eks. "Test: Kjør alle tester")

---

## 🔍 Pre-PR Review Workflow

**Review koden din FØR du lager PR:**

### Metode 1: Bruk GitHub Copilot CLI

```bash
# Be Copilot reviewe dine endringer
? Review mine endringer mot KODESTANDARD.md

# Eller mer spesifikt:
? Kjør pre-PR review: sjekk sikkerhet, ytelse, tilgjengelighet og KODESTANDARD.md
```

### Metode 2: Manuell review-kommando

```bash
# Se hva som er endret
git status
git diff

# Be Copilot om review
? Review denne diffen
```

### Hva reviewes?

Copilot sjekker:
- ✅ **KODESTANDARD.md** - TypeScript, React, testing
- ✅ **Sikkerhet** - XSS, secrets, input validation
- ✅ **Ytelse** - Unødvendige re-renders, ineffektive loops
- ✅ **Tilgjengelighet** - ARIA, semantisk HTML, tastaturnavigasjon
- ✅ **Testing** - Test coverage, TDD-prinsipper
- ✅ **Git** - Commit-struktur, filhåndtering

### Eksempel på review-forespørsel

```text
? Jeg har gjort endringer i UserForm.tsx og userService.ts.
  Kan du reviewe mot KODESTANDARD.md før jeg committer?
  Fokuser spesielt på:
  - Form validation
  - Error handling
  - Accessibility
```

---

## 🛠️ VS Code Tasks

**Kjør en task:**
1. `Cmd+Shift+P` / `Ctrl+Shift+P` → "Tasks: Run Task"
2. Velg ønsket task
3. Følg instruksjonene i terminalen

**Tilgjengelige tasks:**
- `Aide: Opprett JIRA-dokumentasjon` - Opprett dokumentstruktur
- `Test: Kjør alle tester` - Full test-suite
- `Test: Kjør spesifikk testfil` - Kjør én testfil
- `QA: TypeScript check` - Type checking
- `QA: ESLint` - Linting
- `QA: Full kvalitetssjekk` - Alt over i sekvens

---

## 🤖 Hvordan bruke Copilot i dette workspace

### Agent Mode (anbefalt)

Copilot's Agent Mode kan følge multi-step workflows autonomt:

**Eksempel: Analyser JIRA-sak**
```text
@workspace Analyser PROJ-7890 i Agent Mode.
Følg "Autonome workflows" fra custom instructions.
```

Copilot vil da:
1. Opprette dokumentstruktur
2. Analysere kodebasen
3. Oppdatere 2-analyse.md og 3-løsning.md
4. Stage filer med git

### Natural Language Commands

I stedet for slash commands (som Claude Code), bruk natural language:

| Claude Code | Copilot ekvivalent |
|-------------|-------------------|
| `/aide-opprett PROJ-7890` | "Opprett dokumentasjon for PROJ-7890" |
| `/aide-analyser PROJ-7890` | "Analyser PROJ-7890" |
| `/aide-løs PROJ-7890` | "Implementer PROJ-7890 med TDD" |

### Bruk Tasks for repetitive kommandoer

For kommandoer du kjører ofte:
1. `Cmd+Shift+P` → "Tasks: Run Task"
2. Eller sett opp keyboard shortcuts (se nedenfor)

---

## ⌨️ Anbefalte keyboard shortcuts

Legg til i din `keybindings.json` (File → Preferences → Keyboard Shortcuts → Open Keyboard Shortcuts JSON):

```json
[
  {
    "key": "cmd+k cmd+j",
    "command": "workbench.action.tasks.runTask",
    "args": "Aide: Opprett JIRA-dokumentasjon"
  },
  {
    "key": "cmd+k cmd+a",
    "command": "workbench.action.tasks.runTask",
    "args": "QA: Full kvalitetssjekk"
  },
  {
    "key": "cmd+k cmd+t",
    "command": "workbench.action.tasks.runTask",
    "args": "Test: Kjør alle tester"
  }
]
```

---

## 📁 Dokumentasjonstruktur

- **JIRA-tickets:** `reports/<NN>-{ISSUE_ID}-slug/`
  - `1-beskrivelse.md`, `2-analyse.md`, `3-løsning.md`, `4-status.md`
  - **OBS:** Hvis `AIDE_REPORTS_PATH` er satt, skrives reports dit i stedet
- **Todo-planer:** `reports/`
- **Generiske workflows:** `core/rules/`

---

## 🚫 KRITISK: Copilot-spesifikke regler

### Commit-håndtering

**Copilot kan IKKE kjøre `git commit` direkte.**

**Når du ber Copilot om å committe:**
1. Copilot vil kjøre `git status`
2. Copilot vil kjøre `git add <file>` for nye filer
3. Copilot vil **gi deg commit-meldingen** som tekst
4. **DU må kjøre `git commit` selv** i terminalen

**Format for commit-meldinger:** Se [core/rules/git.md](core/rules/git.md)

### MCP Servers (Model Context Protocol)

Hvis tilgjengelig via Copilot extensions:
- MCP server for JIRA - hent JIRA-data
- MCP server for Confluence - dokumentasjonsoppslag

---

## 🛠️ Mest brukte kommandoer

**Via Copilot Chat (natural language):**

```text
# JIRA-arbeidsflyt
"Opprett dokumentasjon for PROJ-7890"
"Analyser PROJ-7890"
"Implementer PROJ-7890 med TDD"

# TODO-arbeidsflyt
"Opprett TODO-plan for Redux Form-migrering"
"Analyser TODO-01"
"Implementer TODO-01"

# Andre oppgaver
"Konverter UserProfile.tsx til functional component"
"Lag tester for validateSøknad"
```

**Via VS Code Tasks (Command Palette):**
- `Tasks: Run Task` → "Aide: Opprett JIRA-dokumentasjon"
- `Tasks: Run Task` → "QA: Full kvalitetssjekk"
- `Tasks: Run Task` → "Test: Kjør alle tester"

---

## 🔗 Videre lesing

**Må lese før bruk:**
- ✅ [core/rules/workflows.md](core/rules/workflows.md) - JIRA/TODO workflows
- ✅ [core/rules/git.md](core/rules/git.md) - Git best practices
- ✅ [core/rules/testing.md](core/rules/testing.md) - Testing-regler

**Copilot-spesifikk dokumentasjon:**
- ✅ [implementations/copilot/README.md](implementations/copilot/README.md) - Copilot setup guide
- ✅ [core/AGENTS.md](core/AGENTS.md) - Instruksjoner (installeres til ~/.copilot/copilot-instructions.md)

**For fullstendig workspace-oversikt:**
- 📄 [README.md](README.md) - Workspace-oversikt

---

## 💡 Tips og triks

### 1. Bruk @workspace for kontekst

```text
@workspace Finn alle komponenter som bruker redux-form
```

Copilot får tilgang til hele kodebasen (ikke bare åpen fil).

### 2. Vær spesifikk om fase

```text
Analyser PROJ-7890, men STOPP etter analyse.
IKKE implementer enda - jeg må godkjenne planen først.
```

### 3. Referer til dokumentasjon eksplisitt

```text
Følg TDD-prosessen fra core/rules/testing.md:
RED → GREEN → REFACTOR med pause mellom hver fase.
```

### 4. Bruk Agent Mode for komplekse oppgaver

Aktivér Agent Mode i Copilot Chat:
- Klikk på "agent" dropdown
- Eller start prompt med "@workspace" for automatisk agent-deteksjon

---

## 🔄 Sammenligning med Claude Code

| Feature | Claude Code | Copilot (VS Code) |
|---------|-------------|-------------------|
| **Kommandoer** | `/aide-opprett` | Natural language eller Tasks |
| **Instruksjoner** | `CLAUDE.md` (auto-read) | `.github/copilot-instructions.md` |
| **Permissions** | Fine-grained i settings.json | Workspace Trust (all-or-nothing) |
| **Bash commands** | Direkte kjøring (pre-approved) | Via Tasks eller manual terminal |
| **Git commit** | Blocked (deny list) | Copilot kan ikke kjøre (må gjøres manuelt) |
| **Agent Mode** | Innebygd | Innebygd (siden 2024) |
| **MCP support** | ✅ | ✅ (via extensions) |

---

**Lykke til med GitHub Copilot! 🚀**
