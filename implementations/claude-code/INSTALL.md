# Installasjonsveiledning - doc-aide-claude-code

## Quick Start

```bash
# 1. Pakk ut zip-filen
cd ~/develop
unzip doc-aide-claude-code.zip
cd doc-aide-claude-code

# 2. Sett environment-variabler (legg til i ~/.zshrc)
export AIDE_PROJECTS_PATH="$HOME/develop"

# 3. Kjør install
./install.sh

# 4. Start Claude Code i et prosjekt
cd $AIDE_PROJECTS_PATH/my-app
claude
```

**Test:** Kjør `/aide-opprett PROJ-7637` i Claude Code.

---

## Forutsetninger

- **Claude Code CLI** installert (`claude` kommandoen fungerer)
- **Python 3.8+** (for scripts)
- **Tilgang til JIRA** (https://jira.example.com)
- **Mac/Linux** eller **Windows med WSL** (bash-scripts krever Unix-shell)

> **Windows-brukere:** Scriptene er bash-scripts og krever [WSL (Windows Subsystem for Linux)](https://learn.microsoft.com/en-us/windows/wsl/install) eller Git Bash. Kjør `wsl --install` i PowerShell for å installere WSL.

---

## Hva gjør install.sh?

1. **Installerer scripts** til `~/.local/bin/`:
   - `aide-generate-pdf`, `aide-generate-html` - PDF/HTML-eksport
   - `mise-upgrade-ai-tools` - Oppdaterer AI-CLI-ene

2. **Installerer globalt** til `~/.claude/`:
   - `skills/` - skills (eksperter + aide-* workflows)
   - `agents/` - Spesialiserte agenter
   - `rules/` - Generiske regler

3. **Installerer LSP-plugins** (typescript, kotlin, jdtls)

### Native Claude Code Skills

Skills er ekspertise-moduler som Claude Code automatisk aktiverer basert på kontekst:

```text
.claude/skills/
├── tdd-coach/SKILL.md               # Test-Driven Development
├── task-workflow-assistant/SKILL.md # JIRA/TODO-analyse
└── architecture-advisor/SKILL.md    # Arkitektur-vurderinger
```

**Eksempel:** Når du skal implementere ny funksjonalitet, aktiveres `tdd-coach` automatisk og veileder Claude Code gjennom RED → GREEN → REFACTOR.

---

## Environment Variables

### AIDE_PROJECTS_PATH (påkrevd)

```bash
export AIDE_PROJECTS_PATH="$HOME/develop"
```

Rot-mappen hvor prosjektene dine ligger.

### AIDE_REPORTS_PATH (valgfri)

```bash
export AIDE_REPORTS_PATH="$HOME/Documents/aide-reports"
```

Hvor JIRA-dokumentasjon og TODO-planer lagres. Hvis ikke satt, brukes `doc-aide-claude-code/reports/`.

---

---

## LSP-plugins (semantisk kodeforståelse)

Claude Code har innebygd støtte for LSP-plugins som gir semantisk kodenavigasjon
(symbol-søk, finn referanser, refactoring). Disse installeres automatisk av `install.sh`.

**Installerte plugins:**

| Plugin | Språk | Bruksområde |
|--------|-------|-------------|
| `typescript-lsp` | TypeScript/JavaScript | my-app |
| `kotlin-lsp` | Kotlin | my-api |
| `jdtls-lsp` | Java | my-api |

**Manuell installasjon** (hvis nødvendig):

```bash
claude plugin install typescript-lsp@claude-plugins-official
claude plugin install kotlin-lsp@claude-plugins-official
claude plugin install jdtls-lsp@claude-plugins-official
```

### JIRA MCP (alternativ til cookies)

Hvis du har JIRA MCP-server, kan den brukes i stedet for cookie-basert autentisering.

---

## Tilgjengelige skills

### Slash commands (skills i Claude Code)

| Kommando | Beskrivelse |
|----------|-------------|
| `/aide-opprett PROJ-XXXX` | Opprett JIRA-dokumentasjon |
| `/aide-opprett todo-navn Beskrivelse` | Opprett TODO-plan |
| `/aide-analyser PROJ-XXXX` | Analyser kodebase |
| `/aide-løs PROJ-XXXX` | Implementer med TDD |
| `/aide-react-class-to-func <fil>` | Konverter React class til functional |
| `/aide-lag-tester <fil>` | Generer manglende tester |

### Terminal-scripts

| Script | Beskrivelse |
|--------|-------------|
| `aide-generate-pdf` | Generer PDF fra rapport |
| `aide-generate-html` | Generer HTML fra rapport |
| `mise-upgrade-ai-tools` | Oppdater AI-CLI-ene |

Dokumentopprettelse skjer via slash-kommandoen `/aide-opprett` (ikke et terminal-script).

---

## Feilsøking

### "/aide-opprett kommando ikke funnet"

```bash
# Verifiser at AIDE_PROJECTS_PATH er satt
echo $AIDE_PROJECTS_PATH

# Kjør install på nytt
cd /path/to/doc-aide-claude-code
./install.sh

# Restart Claude Code
```

---

## Oppdatere

For å oppdatere til ny versjon:

1. Last ned ny zip-pakke
2. Pakk ut (overskriver gammel)
3. Kjør `./install.sh` på nytt

---

## Videre lesning

- `README.md` - Oversikt
- `CLAUDE.md` - AI-instruksjoner
- `core/rules/workflows.md` - Arbeidsflyter
- `core/rules/git.md` - Git-regler
