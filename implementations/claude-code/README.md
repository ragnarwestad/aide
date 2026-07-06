# JIRA-integrasjon for Claude Code

## Innholdsfortegnelse

- [Oversikt](#oversikt)
- [Oppsett (første gang)](#oppsett-første-gang)
  - [Environment variables](#steg-0-valgfritt-konfigurer-environment-variables)
  - [Install-script](#steg-1-kjør-install-script)
- [Daglig bruk](#daglig-bruk)
  - [JIRA-sak](#starte-arbeid-på-en-ny-jira-sak)
  - [TODO-plan](#starte-arbeid-på-en-todo-plan)
- [Feilsøking](#feilsøking)
- [Filer og struktur](#filer-og-struktur)
- [Hvordan det fungerer](#hvordan-det-fungerer)
- [Tips og triks](#tips-og-triks)
- [Headless Mode](#headless-mode)
- [Ressurser](#ressurser)

---

Denne katalogen inneholder Claude Code-implementasjonen med konfigurasjonsfiler, skills og agents.

**Referanser:**
- Claude Code-instruksjoner: Se `CLAUDE.md`
- Agent-dokumentasjon: Se `agents/README.md`
- Generiske workflows: Se `../../core/rules/workflows.md`

---

## Oversikt

JIRA-integrasjonen lar deg automatisk:
- Opprette strukturert dokumentasjon i `reports/`-mappen
- Analysere kodebasen og generere løsningsforslag
- Implementere med TDD-arbeidsflyt (RED → GREEN → REFACTOR)

**📦 Installasjon:** Se **[INSTALL.md](./INSTALL.md)** for komplett veiledning (5 min)

**Tilgjengelige skills:**
```bash
# JIRA-arbeidsflyt (detekteres automatisk fra PROJ-* prefix)
/aide-create PROJ-7637           # Opprett dokumentstruktur
/aide-analyze PROJ-7637          # Analyser kodebase
/aide-implement PROJ-7637               # Implementer med TDD

# TODO-arbeidsflyt (med todo- prefix)
/aide-create todo-redux-form-migration Flytt forms fra Redux Form
# → Genererer: todo-01-redux-form-migration

/aide-create todo Flytt forms      # Autogenerert slug
# → Genererer: todo-01-flytt-forms

/aide-analyze todo-01               # Analyser (shorthand - søker etter todo-01-*)
/aide-implement todo-01                    # Implementer (shorthand)

# Utility
/aide-to-pdf PROJ-7637            # Generer PDF-dokument
```

**Resultat av /aide-create (JIRA mode):**
- ✅ Dokumentstruktur opprettet i reports/<NN>-PROJ-7637-slug/
- ✅ 1-description.md fylt ut med JIRA-metadata + description
- ✅ Tomme filer: 2-analysis.md, 3-solution.md, 4-status.md

**Resultat av /aide-analyze:**
- ✅ Kodebase analysert (via @agent-jira-analyzer eller @agent-todo-analyzer)
- ✅ Alle 4 dokumentfiler oppdatert med analyse og løsningsforslag
- ✅ Konkrete filer og linjenummer identifisert

**Arkitektur:**
```text
/aide-create PROJ-7637 → Oppretter dokumentstruktur
    ↓
/aide-analyze PROJ-7637 → @agent-jira-analyzer
    ↓
    Analyserer kodebase (Explore agent)
    ↓
    Oppdaterer dokumentasjon
    ↓
/aide-implement PROJ-7637 → @agent-tdd-implementer
    ↓
    RED → GREEN → REFACTOR (med brukerbekreftelse)
```

---

## Oppsett (første gang)

### Steg 0: (Valgfritt) Konfigurer environment variables

**Før du kjører setup-scriptet**, kan du sette environment variables for å tilpasse oppsettet:

#### AIDE_REPORTS_PATH - Lagre reports utenfor workspace

**Bruk dette hvis du vil:**
- Lagre reports i eget privat git repo
- Bruke skylagring (Dropbox, iCloud, etc.)
- Separere workspace-kode fra bruker-spesifikke reports

```bash
# I ~/.zshrc eller ~/.bashrc
export AIDE_REPORTS_PATH="/Users/$(whoami)/Documents/aide-reports"
# eller
export AIDE_REPORTS_PATH="/Users/$(whoami)/Dropbox/aide-reports"

# Last inn endringene
source ~/.zshrc  # eller source ~/.bashrc
```

**Hvis ikke satt:** Reports skrives til `doc-aide/reports/` (default, gitignored)

#### AIDE_PROJECTS_PATH - Permissions uten spørsmål

Settes (valgfritt) for at Claude Code skal generere absolutte stier i permissions:

```bash
# I ~/.zshrc eller ~/.bashrc
export AIDE_PROJECTS_PATH="/Users/$(whoami)/develop"

# Last inn endringene
source ~/.zshrc  # eller source ~/.bashrc
```

---

### Steg 1: Kjør install-script

```bash
cd doc-aide/implementations/claude-code
./install.sh
```

**Scriptet installerer globalt:**
- ✅ Scripts → `~/.local/bin/` (`aide-generate-pdf`, `aide-generate-html`, `mise-upgrade-ai-tools`)
- ✅ Skills, agents og regler → `~/.claude/`
- ✅ LSP-plugins (typescript, kotlin, jdtls)

Kjør `./install.sh` på nytt for å oppdatere etter endringer.


---

## Daglig bruk

### Starte arbeid på en ny JIRA-sak

1. **Finn JIRA-saksnummer** (f.eks. PROJ-7637)

2. **Start Claude Code** (i et hvilket som helst prosjekt: my-app, doc-aide, my-api, etc.)

3. **Kjør slash-kommandoen:**
   ```bash
   /aide-create PROJ-7637
   ```

4. **Claude vil automatisk:**
   - Opprette dokumentstruktur: `../doc-aide/reports/<NN>-PROJ-7637-slug/`
   - Fylle ut `1-description.md` med JIRA-metadata
   - Gi deg en oppsummering

5. **Analyser kodebasen:**
   ```bash
   /aide-analyze PROJ-7637
   ```

6. **Les dokumentasjonen:**
   ```bash
   cat ../doc-aide/reports/<NN>-PROJ-7637-slug/2-analysis.md
   cat ../doc-aide/reports/<NN>-PROJ-7637-slug/3-solution.md
   ```

7. **Implementer løsningen (valgfritt):**
   ```bash
   /aide-implement PROJ-7637
   ```

### Starte arbeid på en TODO-plan

1. **Start Claude Code** (i et hvilket som helst prosjekt)

2. **Opprett TODO-plan:**

   Med eksplisitt navn:
   ```bash
   /aide-create todo-redux-form-migration Flytt alle forms fra Redux Form til React Hook Form
   ```
   → Genererer: `todo-01-redux-form-migration`

   Eller autogenerert fra beskrivelse:
   ```bash
   /aide-create todo Flytt forms til React Hook Form
   ```
   → Genererer: `todo-01-flytt-forms-til-react-hook-form`

3. **Analyser (bruk shorthand):**
   ```bash
   /aide-analyze todo-01
   ```

   Eller med full ID:
   ```bash
   /aide-analyze todo-01-redux-form-migration
   ```

4. **Implementer (bruk shorthand):**
   ```bash
   /aide-implement todo-01
   ```

---

## Feilsøking

### Problem: `/aide-create` kommandoen ikke funnet

**Årsak:** Skill ikke lastet eller feil plassert

**Løsning:**
1. Sjekk at mappen eksisterer: `~/.claude/skills/aide-create/SKILL.md`
2. Restart Claude Code
3. Prøv igjen

### Problem: Dokumentasjon eksisterer allerede

**Dette er OK!** `/aide-create` kan kjøres på nytt for å oppdatere 1-description.md.

### Problem: Claude spør om permissions selv om de er satt i settings.json

**Årsak:** Claude Code ekspanderer relative stier til absolutte stier, og permissions matcher kun eksakt.

**Løsning:**

Se **"Steg 0: (Valgfritt) Konfigurer environment variables"** i setup-seksjonen.

Kort versjon:
1. Sett `AIDE_PROJECTS_PATH` i `~/.zshrc` eller `~/.bashrc`
2. Kjør `source ~/.zshrc` for å laste inn
3. Kjør `./install.sh` på nytt

---

## Filer og struktur

### Config-filer (source of truth i git)

```text
doc-aide/
├── core/                               # Felles (delt av alle AI-verktøy)
│   ├── rules/                          # Workflows, git, testing, standarder
│   ├── skills/                         # Skills (SKILL.md)
│   ├── scripts/                        # CLI-scripts (aide-generate-pdf m.fl.)
│   └── templates/                      # Dokumentmaler
│
└── implementations/claude-code/        # Claude Code-implementasjon
    ├── README.md                       # Denne filen
    ├── INSTALL.md                      # Installasjonsguide
    ├── install.sh / uninstall.sh       # Global install/avinstaller
    ├── settings.json                   # Mal for ~/.claude/settings.json
    └── agents/                         # Agent-definisjoner → ~/.claude/agents/
        ├── README.md
        └── *.md                        # Spesialiserte agents
```

### Runtime-filer (installert lokalt, ikke i git)

```text
~/.local/bin/aide-generate-pdf               # Installert fra core/scripts/
~/.local/bin/aide-generate-html              # Installert fra core/scripts/
~/.local/bin/mise-upgrade-ai-tools           # Installert fra core/scripts/

$AIDE_PROJECTS_PATH/
├── CLAUDE.md                           # Delt AI-instruksjoner
└── .claude/                            # Delt konfigurasjon
    ├── settings.json                   # Permissions (absolutte stier)
    ├── skills/                         # Alle skills (ekspert + aide-* workflows)
    │   ├── aide-create/SKILL.md
    │   ├── aide-analyze/SKILL.md
    │   ├── aide-implement/SKILL.md
    │   ├── tdd-coach/SKILL.md
    │   ├── my-app-expert/SKILL.md
    │   ├── my-api-expert/SKILL.md
    │   ├── task-workflow-assistant/SKILL.md
    │   └── architecture-advisor/SKILL.md
    └── agents/                         # Spesialiserte agents

doc-aide/
├── CLAUDE.md → ../CLAUDE.md            # Symlink til delt fil
└── .claude → ../.claude                # Symlink til delt konfigurasjon

my-app/
├── CLAUDE.md → ../CLAUDE.md            # Symlink til delt fil
└── .claude → ../.claude                # Symlink til delt konfigurasjon

my-api/
├── CLAUDE.md → ../CLAUDE.md            # Symlink til delt fil
└── .claude → ../.claude                # Symlink til delt konfigurasjon

my-docs/
├── CLAUDE.md → ../CLAUDE.md            # Symlink til delt fil
└── .claude → ../.claude                # Symlink til delt konfigurasjon
```

### Output-filer (generert av kommandoer - AI-agnostic)

```text
doc-aide/reports/
├── PROJ-7637/
│   ├── 1-description.md     # Generert av /aide-create
│   ├── 2-analysis.md         # Generert av /aide-analyze
│   ├── 3-solution.md         # Generert av /aide-analyze
│   └── 4-status.md          # Generert av /aide-analyze
└── PROJ-XXXX/
    └── [samme struktur]
```

---

## Hvordan det fungerer

### 1. Unified /aide-* skills

**`/aide-create PROJ-XXXX`** (detekterer JIRA mode fra format)
1. Oppretter dokumentstruktur (4 filer)
2. Fyller ut 1-description.md med JIRA-metadata (brukeren limer inn JIRA-data manuelt)

**`/aide-analyze PROJ-XXXX`**
1. Analyserer kodebase med Explore agent (@agent-jira-analyzer)
2. Identifiserer berørte filer (med linjenummer)
3. Oppdaterer alle 4 dokumentfiler

**`/aide-implement PROJ-XXXX`**
1. Leser 2-analysis.md og 3-solution.md
2. Implementerer med TDD (RED → GREEN → REFACTOR)
3. Oppdaterer 4-status.md underveis

**`/aide-to-pdf PROJ-XXXX`**
1. Kombinerer alle markdown-filer (1-4) til ett dokument
2. Legger til forside med metadata
3. Konverterer til PDF med sidehode/sidefot
4. Output: `<docs-folder>/PROJ-XXXX.pdf`

---

## Tips og triks

### Se alle JIRA-saker du har jobbet med

```bash
ls -lt ../doc-aide/reports/
```

### Re-analyser når kodebasen endres

```bash
# Hvis kodebasen har endret seg siden sist analyse
/aide-analyze PROJ-7890
```

---

## Eksempel-flyt

```bash
# 1. Opprett dokumentasjon (auto-detekterer JIRA fra PROJ-format)
/aide-create PROJ-7890

# Claude henter saken og oppretter dokumentstruktur

# 2. Analyser kodebase
/aide-analyze PROJ-7890

# Claude analyserer kodebase og oppdaterer dokumentasjon

# 3. Les dokumentasjonen
cat ../doc-aide/reports/<NN>-PROJ-7890-slug/2-analysis.md
cat ../doc-aide/reports/<NN>-PROJ-7890-slug/3-solution.md

# 4. Implementer løsning (valgfritt - TDD-assistert)
/aide-implement PROJ-7890

# Eller kode manuelt basert på dokumentasjonen

# 5. Generer PDF for deling/arkivering (valgfritt)
/aide-to-pdf PROJ-7890

# Åpne PDF
open ../doc-aide/reports/<NN>-PROJ-7890-slug/PROJ-7890.pdf
```

---

## Headless Mode

Claude Code støtter headless mode (`-p` flag) for ikke-interaktiv kjøring:

```bash
# Grunnleggende headless mode
claude -p "Say hello"

# Med tool-tillatelser (unngår bekreftelser)
claude -p "List files" --allowedTools "Bash,Read,Write,Edit"

# Med JSON output for programmatisk parsing
claude -p "Analyze this code" --output-format json

# Med streaming JSON for multi-turn
claude -p "Complex task" --output-format stream-json
```

**Viktige flagg:**

| Flag | Beskrivelse |
|------|-------------|
| `-p "prompt"` | Headless mode - kjører uten interaktiv UI |
| `--allowedTools` | Gir tillatelser uten bruker-input |
| `--output-format json` | JSON output for parsing |
| `--output-format stream-json` | Streaming JSON for multi-turn |

---

## Ressurser

**Offisiell dokumentasjon og best practices:**

- [Anthropic: Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices) - Offisielle tips for effektiv bruk
- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code) - Fullstendig dokumentasjon
- [CLI Reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage) - Alle CLI-flagg inkludert headless mode
- [Anthropic Prompt Engineering](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering) - Prompt-teknikker
