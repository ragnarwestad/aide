# Installasjon - Doc Aide

> **📝 Merk:** For AI-spesifikk installasjon, se primært:
> - **Claude Code:** [implementations/claude-code/INSTALL.md](../implementations/claude-code/INSTALL.md)
> - **Copilot:** [implementations/copilot/INSTALL.md](../implementations/copilot/INSTALL.md)
>
> Denne guiden gir en overordnet oversikt.

Komplett steg-for-steg guide for å sette opp AI-workspace med ditt foretrukne AI-verktøy.

---

## Innholdsfortegnelse

- [Velg ditt AI-verktøy](#velg-ditt-ai-verktøy)
- [Generell oppsett (alle AI-verktøy)](#generell-oppsett-alle-ai-verktøy)
  - [Steg 1: Klon AI-workspace](#steg-1-klon-ai-workspace)
  - [Steg 2: JIRA-data](#steg-2-jira-data)
- [AI-verktøy-spesifikk installasjon](#ai-verktøy-spesifikk-installasjon)
  - [Installer alt på én gang](#installer-alt-på-én-gang)
  - [Claude Code](#claude-code)
  - [GitHub Copilot](#github-copilot)
  - [Andre AI-verktøy](#andre-ai-verktøy)
- [Verifiser oppsettet](#verifiser-oppsettet)
- [Feilsøking](#feilsøking)

---

## Velg ditt AI-verktøy

Dette workspace'et støtter flere AI-verktøy. Velg det som passer deg best:

| AI-verktøy         | Fordeler                                           | Best for                                     | Installasjonsdokumentasjon                                               |
|--------------------|----------------------------------------------------|----------------------------------------------|--------------------------------------------------------------------------|
| **Claude Code**    | Slash commands, spesialiserte agents, 200K context | Komplekse JIRA-analyser, tverrfaglige saker  | [claude-code/README.md](../implementations/claude-code/README.md)         |
| **Codex (OpenAI)** | Prompt-templates, manuell workflow                 | JIRA/TODO analyse og implementering          | [../implementations/codex/README.md](../implementations/codex/README.md) |
| **GitHub Copilot** | Native VS Code, Agent Mode, rask respons           | Quick edits, refaktorering, single-file work | [copilot/README.md](../implementations/copilot/README.md)                 |

**💡 Tips:** Du kan bruke flere AI-verktøy samtidig! Velg beste verktøy for hver oppgave.

---

## Generell oppsett (alle AI-verktøy)

Disse stegene gjelder uansett hvilket AI-verktøy du bruker.

### Forutsetninger

**Du må ha:**

- ✅ Git installert
- ✅ Tilgang til NAVs JIRA: https://jira.example.com
- ✅ prosjektene dine klonet og fungerende

**Mappestruktur etter oppsett:**

> **📝 Merk:** Eksemplene under bruker `~/develop/` som base-katalog. Du kan bruke en annen struktur, men
> workspace'et bør ligge som **søsken** til prosjektene dine for at relative stier skal fungere optimalt.

```text
~/develop/          # Eksempel - tilpass til din struktur
├── doc-aide/       # AI-workspace (dette repoet)
├── my-app/         # eksempel-prosjekt
├── my-api/         # eksempel-prosjekt
└── ...             # andre prosjekter
```

---

### Steg 1: Klon AI-workspace

Klon workspace'et som **søsken** til prosjektene dine (eller der du ønsker):

```bash
cd ~/develop/
git clone <repo-url> doc-aide
cd doc-aide
```

**Verifiser strukturen:**

```bash
# Du skal kunne se begge katalogene:
ls -la ~/develop/
# → doc-aide/
# → my-app/
```

---

### Steg 2: JIRA-data

JIRA-data hentes manuelt fra https://jira.example.com og limes inn når AI-verktøyet ber om det.

**Ingen scripts eller API-integrasjon kreves** - du kopierer relevant info direkte fra JIRA-nettleseren.

---

### Steg 3: (Valgfritt) Konfigurer environment variables

Disse er **valgfrie** men anbefalt for bedre arbeidsflyt. Gjelder **alle AI-verktøy**.

#### AIDE_REPORTS_PATH

Lagre JIRA-dokumenter og TODO-planer utenfor workspace (f.eks. i Dropbox/iCloud):

```bash
# I ~/.zshrc eller ~/.bashrc
export AIDE_REPORTS_PATH="/Users/$(whoami)/Documents/aide-reports"
# eller
export AIDE_REPORTS_PATH="/Users/$(whoami)/Dropbox/aide-reports"

# Last inn endringene
source ~/.zshrc  # eller source ~/.bashrc
```

**Fordel:** Reports blir ikke commitet til workspace-repoet, kan synces separat.

#### AIDE_INSTALLATION_PATH

Peker til workspace-roten (for templates og konfigurasjon):

```bash
# I ~/.zshrc eller ~/.bashrc
export AIDE_INSTALLATION_PATH="/Users/$(whoami)/develop/doc-aide"

# Last inn endringene
source ~/.zshrc  # eller source ~/.bashrc
```

**Fordel:** Scripts og templates finner workspace uavhengig av hvor du kjører dem fra.

#### AIDE_PROJECTS_PATH (kun Claude Code)

Eliminerer permission-spørsmål i Claude Code:

```bash
# I ~/.zshrc eller ~/.bashrc
export AIDE_PROJECTS_PATH="/Users/$(whoami)/develop"

# Last inn endringene
source ~/.zshrc  # eller source ~/.bashrc
```

**Fordel:** Claude Code genererer absolutte stier i permissions, slipper å godkjenne hver gang.

---

**✅ Generelt oppsett ferdig!**

Du har nå:
- ✅ Klonet doc-aide workspace
- ✅ (Valgfritt) Konfigurert environment variables

**Neste steg:** Velg ditt AI-verktøy og fullfør installasjon 👇

---

## AI-verktøy-spesifikk installasjon

Velg ditt AI-verktøy og følg relevant guide:

### Installer alt på én gang

Enkleste vei er å installere for alle AI-verktøyene samtidig, fra repo-roten:

```bash
./install-all.sh
```

Den kjører hver AI-implementasjons egen installer. Hver installer er
**selvstendig** og setter opp både felles scripts (`core/scripts/` → `~/.local/bin/`,
inkludert `aide-generate-pdf`, `aide-generate-html` og `mise-upgrade-ai-tools`)
og sitt eget AI-spesifikke oppsett.

I Claude Code kan du i stedet kjøre `/install-all`-skillen. `./uninstall-all.sh`
(eller `/uninstall-all`) reverserer alt — hver installer ber om egen bekreftelse.

**Bare ett verktøy?** Kjør dens installer direkte — den gir alt det verktøyet trenger:

```bash
implementations/claude-code/install.sh
implementations/copilot/install.sh
implementations/codex/install.sh
implementations/gemini/install.sh
```

Avsnittene under beskriver hva hver enkelt installer gjør.

### Claude Code

**Installasjon og oppsett:**

1. **Installer Claude Code CLI:**
   ```bash
   # Se: https://docs.anthropic.com/claude-code/installation
   # Krever Claude Pro/Team-abonnement
   ```

2. **Verifiser installasjonen:**
   ```bash
   claude --version
   # → Claude Code CLI version X.X.X
   ```

3. **Kjør setup-script:**
   ```bash
   cd doc-aide/implementations/claude-code
   ./install.sh
   ```

   **Scriptet installerer globalt:**
    - ✅ Skills, agents og regler → `~/.claude/`
    - ✅ Scripts (inkl. `mise-upgrade-ai-tools`) → `~/.local/bin/`
    - ✅ LSP-plugins (typescript, kotlin, jdtls)

   **💡 Tips:** Hvis du satte environment variables i Steg 3, kjør `source ~/.zshrc` før setup.

4. **Test oppsettet:**
   ```bash
   /aide-create PROJ-7637
   ```

**Full dokumentasjon:**

- **[implementations/claude-code/README.md](../implementations/claude-code/README.md)** - Setup-guide og quick start

**Nøkkelfeatures:**

- ✅ Slash commands (`/aide-create`, `/aide-analyze`, `/aide-implement`)
- ✅ Spesialiserte agents (`@agent-jira-analyzer`, `@agent-tdd-implementer`)
- ✅ Automatisk lesing av CLAUDE.md ved oppstart
- ✅ 200K token context window
- ✅ Automatisk git staging

---

### GitHub Copilot

**Installasjon og oppsett:**

1. **Installer Copilot i VS Code:**
   ```bash
   code --install-extension GitHub.copilot
   code --install-extension GitHub.copilot-chat
   ```

2. **Kjør install-scriptet:**
   ```bash
   # Fra workspace-roten
   implementations/copilot/install.sh
   ```
   Det installerer `AGENTS.md` som global Copilot-instruksjon
   (`~/.copilot/copilot-instructions.md`) og felles scripts til `~/.local/bin/`.

3. **Aktiver Agent Mode:**
    - Åpne Copilot Chat i VS Code (`Ctrl+Shift+I` / `Cmd+Shift+I`)
    - Velg **"agent"** fra chat mode dropdown
    - Konfigurer verktøy via tools-knappen

4. **Test oppsettet:**
    - I Copilot CLI: kjør `/aide-create PROJ-7637` (leser de samme skills som Claude Code)

**Full dokumentasjon:**

- **[implementations/copilot/README.md](../implementations/copilot/README.md)** - Setup-guide og quick start

**Nøkkelfeatures:**

- ✅ Agent Mode for autonome multi-step oppgaver
- ✅ Custom instructions (`.github/copilot-instructions.md`)
- ✅ Slash commands / skills (`/aide-create` m.fl. — samme som Claude Code)
- ✅ Native VS Code-integrasjon (raskere enn Claude CLI)
- ✅ Codebase analysis og test iteration

---

### Andre AI-verktøy

**Codex, eller andre AI-verktøy:**

1. **Se Codex-implementasjon:**
    - **[../implementations/codex/README.md](../implementations/codex/README.md)** - Setup-guide for Codex
    - Kjør `implementations/codex/install.sh` (CLI-wrappers + custom instructions)

2. **Legg til nye AI-verktøy:**
    - Følg samme mønster som Codex/Copilot
    - Opprett `implementations/<tool>/`
    - Gjenbruk `core/rules/`-regler

3. **Bruk generiske workflows:**
    - Les `core/rules/workflows.md` for JIRA/TODO-workflows
    - Følg `core/rules/testing.md` for TDD
    - Følg `core/rules/git.md` for git-operasjoner

4. **Manuell JIRA-opprettelse:**
   ```bash
   # Opprett katalog
   mkdir -p reports/<NN>-PROJ-7637-slug/

   # Fyll ut dokumentasjon basert på templates i core/templates/todo/
   # (Be AI-verktøyet ditt om hjelp - lim inn JIRA-data manuelt)
   ```

**Nøkkelfeatures:**

- ✅ Samme workflows som Claude Code og Copilot
- ✅ Samme 4-fils dokumentstruktur
- ❌ Ingen native slash commands eller agents
- ⚠️ Krever mer manuell prompt engineering

---

## Verifiser oppsettet

Uansett hvilket AI-verktøy du bruker, test at oppsettet fungerer:

### Test 1: Dokumentasjonsopprettelse

**Med Claude Code:**

```bash
/aide-create PROJ-7637
```

**Med Copilot:**

- Kjør `/aide-create PROJ-7637` i Copilot CLI

**Med andre AI-verktøy:**

- Be AI-verktøyet om å opprette dokumentasjon basert på `core/rules/workflows.md`
- Bruk templates fra `core/templates/todo/`

**Forventet resultat:**

```bash
ls -la reports/<NN>-PROJ-7637-slug/
# → README.md
# → 1-description.md (ferdig utfylt)
# → 2-analysis.md (tom)
# → 3-solution.md (tom)
# → 4-status.md (tom)
```

### Test 2: Kodebase-analyse (valgfritt)

Test at AI-verktøyet kan analysere kodebasen:

**Med Claude Code:**

```bash
/aide-analyze PROJ-7637
```

**Med Copilot:**

- Kjør `/aide-analyze PROJ-7637` i Copilot CLI

**Med andre AI-verktøy:**

- Be om kodebase-analyse basert på `1-description.md`
- Følg struktur fra `core/rules/workflows.md`

**Forventet resultat:**

- `2-analysis.md` er ferdig utfylt med påvirkede filer (fil:linje)
- `3-solution.md` inneholder implementeringsplan med TDD-struktur
- `4-status.md` viser initial status

---

## Feilsøking

### Problem: AI-verktøy følger ikke workflows

**Symptom:**

- Copilot hopper over TDD
- Claude Code ignorerer git-regler
- Dokumentasjon mangler 4-fils struktur

**Løsning:**

**For Claude Code:**

```bash
# Kjør setup-scriptet på nytt
cd doc-aide/implementations/claude-code
./install.sh
# Restart Claude Code
```

**For Copilot:**

```bash
# Installer på nytt
implementations/copilot/install.sh

# Restart VS Code / Copilot CLI
```

**For andre AI-verktøy:**

- Vær mer eksplisitt i prompts
- Referer direkte til `core/rules/workflows.md`
- Be om steg-for-steg utførelse

---

## Neste steg

Når oppsettet er ferdig:

1. **Les implementasjonsdokumentasjonen for ditt AI-verktøy:**
    - [implementations/claude-code/README.md](../implementations/claude-code/README.md)
    - [implementations/copilot/README.md](../implementations/copilot/README.md)
    - [AI_ASSISTERT_UTVIKLING.md](./AI_ASSISTERT_UTVIKLING.md)

2. **Les generiske workflows:**
    - [core/rules/workflows.md](../core/rules/workflows.md)
    - [core/rules/documentation.md](../core/rules/documentation.md)

3. **Test med en ekte JIRA-sak:**
    - Opprett dokumentasjon
    - Analyser kodebase
    - Implementer med TDD (valgfritt)

4. **Utforsk videre:**
    - Les README.md for full oversikt
    - Se [AI_DEVELOPMENT_GUIDE.md](./AI_DEVELOPMENT_GUIDE.md) for arkitektur

---

**Lykke til med AI-assistert utvikling! 🚀**

**Velg ditt verktøy, følg guiden, og kom i gang!**
