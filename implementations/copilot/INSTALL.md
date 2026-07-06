# Installasjonsveiledning - GitHub Copilot

## Innholdsfortegnelse

- [Oversikt](#oversikt)
- [Quick Start](#quick-start)
- [Detaljert installasjon](#detaljert-installasjon)
  - [Steg 0: Copilot CLI og VS Code extensions](#steg-0-installer-copilot-cli-og-vs-code-extensions)
  - [Steg 1: install.sh](#steg-1-installer-konfigurasjon-installsh)
  - [Steg 2: Slash commands](#steg-2-slash-commands)
- [Verifisering](#verifisering)
- [Oppdatering av konfigurasjon](#oppdatering-av-konfigurasjon)
- [For utviklere av doc-aide](#for-utviklere-av-doc-aide)
- [Viktige begrensninger](#viktige-begrensninger)
- [Sammenligning med Claude Code](#sammenligning-med-claude-code)
- [Feilsøking](#feilsøking)
- [Videre lesing](#videre-lesing)

---

## Oversikt

Denne guiden viser hvordan du installerer GitHub Copilot-integrasjonen for doc-aide-workspace **første gang**.

**Tidskrav:** ~5 minutter

**Forutsetninger:**

- GitHub Copilot-abonnement (Individual, Business, Pro eller Enterprise)
- Node.js 22+ (for Copilot CLI via npm) eller Homebrew
- Tilgang til JIRA-instansen din (valgfritt)
- Git-klon av `doc-aide` (og valgfritt `my-app`, `my-api`, etc.)
- `AIDE_PROJECTS_PATH` environment variable satt (se Quick Start)

**Merk:** Copilot CLI ble [GA 25. februar 2026](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/) og leser **CLAUDE.md** direkte fra prosjektroten, noe som forenkler oppsettet.

---

## Quick Start

```bash
# 1. Installer Copilot CLI
npm install -g @github/copilot
# Eller: brew install copilot-cli
# Eller: curl -fsSL https://gh.io/copilot-install | bash

# 2. Sett AIDE_PROJECTS_PATH (PÅKREVD)
export AIDE_PROJECTS_PATH="/Users/$(whoami)/develop"
echo 'export AIDE_PROJECTS_PATH="/Users/$(whoami)/develop"' >> ~/.zshrc

# 3. Installer konfigurasjon (scripts, custom instructions, VS Code-oppsett)
cd doc-aide/implementations/copilot
./install.sh
```

**Ferdig!** Test med `copilot` i terminalen.

---

## Detaljert installasjon

### Steg 0: Installer Copilot CLI og VS Code extensions

**Copilot CLI (terminal):**

```bash
# Via npm (anbefalt, krever Node.js 22+)
npm install -g @github/copilot

# Via Homebrew
brew install copilot-cli

# Via curl (Linux/macOS)
curl -fsSL https://gh.io/copilot-install | bash
```

**VS Code extensions (valgfritt, for Agent Mode i IDE):**

```bash
# Installer GitHub Copilot extensions
code --install-extension GitHub.copilot
code --install-extension GitHub.copilot-chat
```

Eller via VS Code:

1. Åpne Extensions (Cmd+Shift+X)
2. Søk etter "GitHub Copilot"
3. Installer begge extensions (Copilot + Copilot Chat)

---

### Steg 1: Installer konfigurasjon (install.sh)

```bash
cd doc-aide/implementations/copilot
./install.sh
```

**Hva gjør install.sh?**
1. ✅ Installerer felles scripts til `~/.local/bin/`:
   - `aide-generate-pdf`, `aide-generate-html` - Dokumentgenerering
   - `mise-upgrade-ai-tools` - Oppdaterer AI-CLI-ene
2. ✅ Installerer `AGENTS.md` som global Copilot-instruksjon i `~/.copilot/copilot-instructions.md`
3. ✅ Verifiserer PATH og GitHub Copilot extension
4. ✅ Installerer JetBrains Live Templates (hvis JetBrains-IDE finnes)

**⚠️ MERK:** `core/AGENTS.md` er allerede bygd (`core/scripts/build-agents-md.sh`) og committed. Vanlige brukere trenger ikke bygge den på nytt.

**Output:**
```text
🔧 GitHub Copilot Setup
=======================

1️⃣  Installerer scripts til ~/.local/bin/...
   ✅ Installert: ~/.local/bin/aide-generate-pdf
   ✅ Installert: ~/.local/bin/aide-generate-html
   ✅ Installert: ~/.local/bin/mise-upgrade-ai-tools

2️⃣  Installerer global Copilot-instruksjon...
   ✅ Installert: ~/.copilot/copilot-instructions.md

3️⃣  Verifiserer PATH...
   ✅ ~/.local/bin er i PATH

4️⃣  Sjekker GitHub Copilot extension...
   ✅ GitHub Copilot extension er installert
```

---

### Steg 2: Slash commands

Ingen ekstra oppsett. Copilot CLI leser de samme skills som Claude Code, så
`/aide-create`, `/aide-analyze`, `/aide-implement` m.fl. virker native i en
`copilot`-sesjon.

---

## Verifisering

### Test at alt fungerer:

**1. Åpne et prosjekt i VS Code:**
```bash
cd $AIDE_PROJECTS_PATH/my-app
code .
```

**2. Sjekk custom instructions:**
- Åpne Copilot Chat (`Cmd+Shift+I`)
- Klikk på "..." → "Settings"
- Verifiser at `.github/copilot-instructions.md` er listet under "Instructions"

**3. Test skills i Copilot CLI:**

```bash
copilot
/skills info aide-create
# Skal vise: Location: /Users/<deg>/.claude/commands/aide-create.md
```

---

## Oppdatering av konfigurasjon

### Når skal du oppdatere?

- ✅ Nye slash commands lagt til og pushet til git
- ✅ Endringer i custom instructions pushet til git
- ✅ Pull/merge fra `main` branch

### Hvordan oppdatere:

```bash
# 1. Pull siste endringer
cd doc-aide
git pull

# 2. Installer på nytt (globalt)
cd implementations/copilot
./install.sh

# 3. Restart VS Code
# Lukk og åpne VS Code på nytt for at endringer skal tre i kraft
```

**⚠️ MERK:** Du trenger IKKE regenere instructions - det er allerede gjort av doc-aide-teamet og committed til git.

---

## For utviklere av doc-aide

**Hvis DU jobber på doc-aide og skal oppdatere Copilot instructions:**

```bash
# 1. Rediger kilden (felles regler eller Copilot-seksjonene)
vim core/rules/<regel>.md          # eller core/agents-intro.md

# 2. Bygg AGENTS.md på nytt
core/scripts/build-agents-md.sh

# 3. Commit og push
git add core/rules/ core/AGENTS.md
git commit -m "Oppdaterte Copilot-instruksjon"
git push
```

**Vanlige brukere** skal IKKE gjøre dette - de får ferdig `AGENTS.md` via git.

---

## Viktige begrensninger

### Permission prompts (Copilot CLI)

Copilot CLI spør om tillatelse for fil-operasjoner og kommandokjøring.

**Løsninger:**

1. **Interaktivt:** Velg "Yes, and approve all for the rest of the running session"
2. **CLI-flagg:** Start med `copilot --allow-all-tools` for full sesjon
3. **Permanent:** Konfigurer `~/.copilot/config.json` med `trusted_folders`
4. **Full auto:** `copilot --yolo` (kun i isolerte miljøer!)

Se [README.md](./README.md#begrensninger) for fullstendig flagg-referanse.

---

## Sammenligning med Claude Code

| Feature | Claude Code | Copilot CLI / VS Code |
|---------|-------------|----------------------|
| **Slash commands / Skills** | ✅ Native `/aide-create` | ✅ Native i CLI (leser `~/.claude/commands/` som skills) |
| **Custom instructions** | ✅ Auto-read CLAUDE.md | ✅ Auto-read CLAUDE.md + copilot-instructions.md |
| **Permissions** | ✅ Pre-approval via settings.json | ✅ config.json + CLI-flagg |
| **Plan mode** | ✅ Native | ✅ Native (Shift+Tab i CLI) |
| **IDE-integrasjon** | ⚠️ Via CLI | ✅ Native VS Code |
| **Agent Mode** | ✅ Autonome workflows | ✅ Autonome workflows |
| **Modeller** | Claude-familien | Claude, GPT, Gemini |
| **Setup** | ✅ `install.sh` | ✅ `install.sh` |

**Konklusjon:**

- Begge bruker de samme reglene fra `core/rules/`
- Copilot CLI leser CLAUDE.md direkte — enklere oppsett enn før
- Copilot er bedre integrert i VS Code
- Claude Code har bedre skills-system og spesialiserte agents

---

## Feilsøking

### Problem: Custom instructions lastes ikke

**Løsning:**
1. Kjør `implementations/copilot/install.sh` på nytt (installerer `~/.copilot/copilot-instructions.md`)
2. Sjekk at fila finnes: `cat ~/.copilot/copilot-instructions.md`
3. Restart Copilot CLI / VS Code

---

## Videre lesing

- `README.md` - Brukerveiledning for Copilot
- `../../COPILOT.md` - Quick start guide (workspace root)
- `../../core/rules/workflows.md` - JIRA/TODO workflows
- `../../DEVELOPING.md` - Utviklerguide for doc-aide

---

**Lykke til med GitHub Copilot! 🚀**
