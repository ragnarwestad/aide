# Doc Aide

Et strukturert workspace for AI-assistert utvikling. Støtter Claude Code, GitHub Copilot, Codex og Gemini.

## Innholdsfortegnelse

- [Visjon](#visjon)
- [For sluttbrukere](#for-sluttbrukere)
- [For utviklere av doc-aide](#for-utviklere-av-doc-aide)
- [Environment variabler](#environment-variabler)
  - [AIDE_INSTALLATION_PATH](#aide_installation_path-påkrevd-for-dist-pakker)
  - [AIDE_PROJECTS_PATH](#aide_projects_path-valgfritt)
  - [AIDE_REPORTS_PATH](#aide_reports_path-valgfritt)
- [AI-assistert arbeidsflyt](#ai-assistert-arbeidsflyt)
- [Ressurser](#ressurser)

---

## Visjon

Dette workspace-et muliggjør en arbeidsflyt der **hvilken som helst AI-assistent** kan:

- Forstå komplekse JIRA-saker og analysere kodebasen automatisk
- Foreslå konkrete løsninger med filreferanser og linjenummer
- Implementere endringer med Test-Driven Development (TDD)
- Følge etablerte planer for teknisk gjeld og modernisering

**Nøkkelfordel:** Ikke låst til én AI-leverandør - team kan velge beste verktøy for hver oppgave.

---

## For sluttbrukere

> **Du trenger ikke klone dette repoet for å bruke doc-aide.**

Last ned ferdig pakke for ditt AI-verktøy:

| AI-verktøy | Pakke | Dokumentasjon |
|------------|-------|---------------|
| Claude Code | `dist/doc-aide-claude-code.zip` | [INSTALL.md](implementations/claude-code/INSTALL.md) |
| GitHub Copilot | `dist/doc-aide-copilot.zip` | [INSTALL.md](implementations/copilot/INSTALL.md) |
| Codex | `dist/doc-aide-codex.zip` | [README.md](implementations/codex/README.md) |
| Gemini | `dist/doc-aide-gemini.zip` | [README.md](implementations/gemini/README.md) |

Hver pakke inneholder alt du trenger: instruksjoner, kommandoer/prompts, scripts og dokumentasjon.

> **Windows-brukere:** Scriptene krever WSL eller Git Bash. Se [WSL-installasjon](https://learn.microsoft.com/en-us/windows/wsl/install).

---

## For utviklere av doc-aide

Vil du **bidra til eller videreutvikle** doc-aide?

👉 **[DEVELOPING.md](DEVELOPING.md)** - Komplett utviklerguide

Inneholder:
- Kom i gang (klon, installer, test, bygg)
- Detaljert katalogstruktur
- Testing
- Hvordan legge til ny funksjonalitet

Workspace-et er designet for å håndtere **tverrfaglige saker** der en JIRA-sak kan påvirke flere prosjekter samtidig.

---

## Environment variabler

### AIDE_INSTALLATION_PATH (påkrevd for dist-pakker)

Path til hvor doc-aide er installert.

```bash
export AIDE_INSTALLATION_PATH="/Users/$(whoami)/develop/doc-aide"
```

### AIDE_PROJECTS_PATH (valgfritt)

Løser permission-problemer når AI-verktøy ekspanderer relative stier.

```bash
export AIDE_PROJECTS_PATH="/Users/$(whoami)/develop"
```

### AIDE_REPORTS_PATH (valgfritt)

Lagre reports (JIRA-analyser, TODO-planer) utenfor workspace-et.

```bash
export AIDE_REPORTS_PATH="/Users/$(whoami)/Documents/aide-reports"
```

**Default:** Reports skrives til `doc-aide/reports/` (gitignored).

---

## AI-assistert arbeidsflyt

Alle AI-verktøy følger samme grunnleggende workflow:

```text
1. OPPRETT dokumentstruktur
   ↓
   Henter JIRA-sak → Oppretter 4 filer (beskrivelse/analyse/løsning/status)

2. ANALYSER kodebase
   ↓
   Søker i kodebase → Identifiserer berørte filer → Oppdaterer dokumentasjon

3. LØS problemet
   ↓
   RED: Skriv tester → GREEN: Implementer → REFACTOR: Verifiser

4. VERIFISER
   ↓
   Kjør tester → Linting → Bygg → Commit
```

**Eksempel (Claude Code):**

```bash
/aide-create PROJ-7890    # Opprett dokumentstruktur
/aide-analyze PROJ-7890   # Analyser kodebase
/aide-implement PROJ-7890        # Implementer med TDD
```

**Se:** [core/rules/workflows.md](core/rules/workflows.md) for detaljer.

---

## Ressurser

- [DEVELOPING.md](DEVELOPING.md) - Utviklerguide for doc-aide
- [core/rules/workflows.md](core/rules/workflows.md) - JIRA/TODO workflows
- [core/rules/git.md](core/rules/git.md) - Git-regler
