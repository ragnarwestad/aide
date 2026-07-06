# OpenAI Codex - Implementasjonsguide

## Innholdsfortegnelse

- [Oversikt](#oversikt)
- [Hva er OpenAI Codex?](#hva-er-openai-codex)
- [Forutsetninger](#forutsetninger)
- [Installasjon](#installasjon)
  - [CLI-wrappers](#steg-3-installer-cli-wrappers-anbefalt)
- [Konfigurasjon](#konfigurasjon)
  - [MCP-servere](#mcp-servere-model-context-protocol)
  - [Execpolicy](#execpolicy-kommandokontroll)
  - [AGENTS.md](#agentsmd-persistente-instruksjoner)
- [Bruk](#bruk)
  - [JIRA-arbeidsflyt](#jira-arbeidsflyt)
  - [TDD-arbeidsflyt](#tdd-arbeidsflyt)
- [Slash commands og wrappers](#slash-commands-og-wrappers)
- [Tips og triks](#tips-og-triks)
- [Begrensninger](#begrensninger)
- [Sammenligning med Claude Code](#sammenligning-med-claude-code)

---

## Oversikt

Denne implementasjonen lar deg bruke **OpenAI Codex CLI** til å følge samme workflows som Claude Code, med terminal-basert AI-assistanse.

**Arkitektur:**
```text
implementations/codex/
├── README.md                           # Denne filen
├── config.toml                         # Codex-konfig (sandbox, MCP)
├── install.sh / uninstall.sh           # Global install: ~/.codex/AGENTS.md + CLI-wrappers
└── scripts/
    ├── codex-aide-opprett              # CLI-wrapper for aide-opprett
    ├── codex-aide-analyser             # CLI-wrapper for aide-analyser
    └── codex-aide-los                  # CLI-wrapper for aide-løs
```

**Gjenbruker:**
- ✅ `core/rules/` - Samme workflows, git-regler, testing-regler
- ✅ `core/templates/` - Samme 4-fils dokumentstruktur
- ✅ `core/scripts/` - Samme scripts (aide-generate-pdf, etc.)

---

## Hva er OpenAI Codex?

**OpenAI Codex** er en AI-kodingsagent fra OpenAI som kan:
- ✅ Kjøre lokalt i terminalen med tilgang til filsystemet
- ✅ Jobbe på mange oppgaver parallelt
- ✅ Navigere i repo, editere filer, kjøre kommandoer
- ✅ Integrere med GitHub, Slack, IDE
- ✅ Bygge hele prosjekter fra scratch
- ✅ Utføre store refaktoreringer

**Forskjell fra GitHub Copilot:**
- GitHub Copilot: IDE-basert, code completion og chat
- OpenAI Codex: Terminal-basert agent, autonome multi-step oppgaver

**Modell:**
- Drevet av GPT-5-Codex (optimalisert for software engineering)

---

## Forutsetninger

### 1. OpenAI-abonnement
- ChatGPT Plus, Pro, Business, eller Enterprise
- API-tilgang (for CLI)

### 2. Codex CLI
```bash
# Installer Codex CLI
npm install -g @openai/codex-cli

# Eller via Homebrew (macOS)
brew install openai/tap/codex
```

### 3. IntelliJ plugin (valgfritt)
```text
# Installer "Codex Launcher" fra JetBrains Marketplace
# https://plugins.jetbrains.com/plugin/28264-codex-launcher
```

---

## Installasjon

### Steg 1: Installer og autentiser Codex

```bash
# Installer CLI
npm install -g @openai/codex-cli

# Autentiser med OpenAI API-nøkkel
codex auth

# Verifiser installasjon
codex --version
```

### Steg 2: Installer instruksjonsfilen (AGENTS.md)

Instruksjonene bor i `core/AGENTS.md` (genereres fra `core/rules/`). `install.sh` kopierer den til `~/.codex/AGENTS.md`:

```bash
cp core/AGENTS.md ~/.codex/AGENTS.md
```

Codex leser `~/.codex/AGENTS.md` automatisk ved oppstart (samt repo-`AGENTS.md` via directory-walk).

### Steg 3: Installer CLI-wrappers (anbefalt)

CLI-wrapperne gjør det enkelt å starte aide-workflows uten manuell kopiering av prompts:

```bash
# Kopier CLI-wrappers til PATH
cp implementations/codex/scripts/codex-aide-* ~/.local/bin/
chmod +x ~/.local/bin/codex-aide-*
```

**Tilgjengelige kommandoer:**

| Kommando | Beskrivelse |
|----------|-------------|
| `codex-aide-opprett <ID>` | Opprett dokumentstruktur for JIRA-sak eller TODO |
| `codex-aide-analyser <ID>` | Analyser kodebase og identifiser påvirkede filer |
| `codex-aide-los <ID>` | Implementer løsning med TDD |

**Eksempler:**

```bash
# JIRA-arbeidsflyt
codex-aide-opprett PROJ-7890
codex-aide-analyser PROJ-7890
codex-aide-los PROJ-7890

# TODO-arbeidsflyt
codex-aide-opprett todo-01-redux-migration
codex-aide-analyser todo-01
codex-aide-los todo-01
```

---

## Konfigurasjon

### Instruksjoner (AGENTS.md)

Codex leser automatisk `~/.codex/AGENTS.md` (installert fra `core/AGENTS.md`) som inneholder:

- 🎯 Workspace-konsept og struktur
- 📋 Referanser til `core/rules/workflows.md`
- 🧪 TDD-regler fra `core/rules/testing.md`
- 🔀 Git-regler fra `core/rules/git.md`
- 📝 Dokumentstandard fra `core/rules/documentation.md`

### Miljøvariabler

```bash
# Legg til i ~/.bashrc eller ~/.zshrc
export OPENAI_API_KEY="your-api-key-here"
export CODEX_MODEL="gpt-5-codex"  # Eller o4-mini for raskere/billigere
```

### MCP-servere (Model Context Protocol)

Codex støtter MCP-servere for utvidet funksjonalitet. Konfigurer i `~/.codex/config.toml`:

```toml
[mcp]
# Eksempel: Filesystem MCP-server
[[mcp.servers]]
name = "filesystem"
command = "npx"
args = ["-y", "@anthropic/mcp-filesystem", "/path/to/allowed/dir"]

# Eksempel: GitHub MCP-server
[[mcp.servers]]
name = "github"
command = "npx"
args = ["-y", "@anthropic/mcp-github"]
env = { GITHUB_TOKEN = "your-token" }
```

**Tilgjengelige MCP-servere:**

- `@anthropic/mcp-filesystem` - Filsystem-tilgang
- `@anthropic/mcp-github` - GitHub-integrasjon
- `@anthropic/mcp-slack` - Slack-integrasjon
- Egendefinerte servere via MCP-protokollen

### Execpolicy (Kommandokontroll)

Definer regler for hvilke kommandoer Codex kan kjøre i `~/.codex/config.toml`:

```toml
[execpolicy]
# Godkjente kommandoer (kjøres uten bekreftelse)
allow = [
  "pnpm *",
  "npm *",
  "npx *",
  "git status",
  "git diff *",
  "git log *"
]

# Blokkerte kommandoer (kan ikke kjøres)
deny = [
  "rm -rf *",
  "git push --force *",
  "git commit *"  # Blokkér commits som i Claude Code
]

# Krever bekreftelse (standard for ukjente kommandoer)
confirm = [
  "git add *",
  "curl *",
  "wget *"
]
```

### AGENTS.md (Persistente instruksjoner)

Codex' instruksjonsfil er `AGENTS.md`. doc-aide genererer `core/AGENTS.md` fra `core/rules/`, og `install.sh` installerer den som `~/.codex/AGENTS.md`. Codex leser i tillegg en `AGENTS.md` i prosjektroten via directory-walk (git-rot → cwd), så prosjekter kan legge til egne regler:

```markdown
# AGENTS.md

## Prosjektregler
- Følg TDD-workflow (RED → GREEN → REFACTOR)
- Bruk norsk i commit-meldinger
- Kjør alltid tester før du anser en oppgave som ferdig
```

---

## Bruk

### JIRA-arbeidsflyt

#### 1. Opprett JIRA-dokumentasjon

**I stedet for:** `/aide-opprett PROJ-7890` (Claude Code)

**Med Codex:**

```bash
# Interaktiv sesjon
codex

# Eller direkte kommando
codex "Opprett strukturert dokumentasjon for JIRA-sak PROJ-7890:

1. Opprett katalog: reports/<NN>-PROJ-7890-slug/
2. Følg core/rules/documentation.md
3. Bruk templates fra core/templates/todo/
4. Fyll ut 1-beskrivelse.md med JIRA-metadata (bruker limer inn data)
5. Opprett tomme filer: 2-analyse.md, 3-løsning.md, 4-status.md
6. Stage alle nye filer i git"
```

**Eller bruk CLI-wrapperen:**
```bash
codex-aide-opprett PROJ-7890
```

#### 2. Analyser kodebase

**I stedet for:** `/aide-analyser PROJ-7890` (Claude Code)

**Med Codex:**

```bash
codex "Analyser kodebasen for JIRA-sak PROJ-7890:

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

**Med Codex:**

```bash
codex "Implementer løsningen for PROJ-7890 med TDD:

RED PHASE:
1. Les 3-løsning.md → Steg 0: Skriv tester
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

Codex støtter TDD-syklusen:
- Skriver tester først (RED)
- Implementerer til tester passerer (GREEN)
- Refaktorerer og verifiserer (REFACTOR)
- Itererer automatisk ved feil

---

## Slash commands og wrappers

Codex leser de samme skills som Claude Code (fra `~/.agents/skills/`), og det
finnes CLI-wrappers for de vanligste workflowene:

| Wrapper | Formål | Tilsvarer Claude Code |
|---------|--------|----------------------|
| `codex-aide-opprett` | Opprett JIRA/TODO-dokumentasjon | `/aide-opprett` |
| `codex-aide-analyser` | Analyser kodebase | `/aide-analyser` |
| `codex-aide-los` | Implementer med TDD | `/aide-løs` |

**Bruk:**
```bash
codex-aide-opprett PROJ-7890
```

---

## Tips og triks

### 1. Vær eksplisitt om kontekst

❌ **Dårlig:**
```bash
codex "Analyser PROJ-7890"
```

✅ **Bra:**
```bash
codex "Analyser PROJ-7890 ved å følge core/rules/workflows.md.
Les først 1-beskrivelse.md, søk deretter i kodebasen,
og oppdater 2-analyse.md med funn (fil:linje)."
```

### 2. Referer alltid til core/rules/

```bash
codex "Følg workflows i core/rules/workflows.md
Følg git-regler i core/rules/git.md
Følg testing-regler i core/rules/testing.md
Følg prosjektets kodestandarder"
```

### 3. Bruk parallelle oppgaver

Codex kan jobbe på flere oppgaver samtidig:

```bash
# Start bakgrunnsoppgave
codex --background "Analyser alle komponenter i src/components/"

# Fortsett med annet arbeid
codex "Implementer ny feature i UserProfile"
```

### 4. Integrer med GitHub

```bash
# Preload repository
codex --github myorg/my-app

# Arbeid med PR
codex "Review PR #123 og sjekk om den følger KODESTANDARD.md"
```

### 5. Bruk IntelliJ-plugin

1. Installer "Codex Launcher" fra Marketplace
2. Høyreklikk i editor → "Open with Codex"
3. Codex åpnes med fil-kontekst

---

## Begrensninger

### Codex har IKKE:
- ❌ Native slash commands (bruker natural language i stedet)
- ❌ Automatisk lesing av CLAUDE.md ved oppstart (bruk `AGENTS.md`)
- ❌ Innebygde agents som `@agent-jira-analyzer`
- ❌ Gratis tier (krever Plus/Pro/Enterprise)

### Codex HAR:
- ✅ Terminal-basert CLI
- ✅ Parallelle oppgaver
- ✅ GitHub/Slack/IDE-integrasjon
- ✅ Instruksjonsfil (`AGENTS.md` → `~/.codex/AGENTS.md`)
- ✅ Codebase analysis
- ✅ Command execution
- ✅ Auto-iterasjon ved feil

### Kostnader:
- API: $1.50/1M input tokens, $6/1M output tokens
- Subscription: ChatGPT Plus/Pro/Business/Enterprise
- Rate limits (kan kjøpe ekstra credits)

### Workarounds:
1. **Slash commands:** Bruk skills (`~/.agents/skills/`) eller `codex-aide-*`-wrappers
2. **Auto-read CLAUDE.md → AGENTS.md:** Bruk `AGENTS.md` (installeres globalt som `~/.codex/AGENTS.md`)
3. **Agents → Explicit prompts:** Be Codex om å følge spesifikke workflows
4. **Gratis → Betalt:** Krever abonnement

---

## Sammenligning med Claude Code

| Feature | Claude Code | OpenAI Codex |
|---------|-------------|--------------|
| **Kommandoer** | Slash commands (`/aide-opprett`) | Natural language prompts |
| **Instruksjoner** | CLAUDE.md (auto-read) | AGENTS.md (~/.codex/AGENTS.md) |
| **Agents** | `@agent-jira-analyzer` | Generell agent |
| **TDD** | Innebygd RED→GREEN→REFACTOR | Støtter TDD-syklus |
| **Codebase analysis** | ✅ | ✅ |
| **Tool calling** | ✅ | ✅ |
| **Parallelle oppgaver** | ❌ | ✅ |
| **GitHub-integrasjon** | Via gh CLI | Native |
| **Slack-integrasjon** | ❌ | ✅ |
| **Context window** | 200K tokens | Varierer (GPT-5) |
| **IDE-integrasjon** | VS Code (via CLI) | IntelliJ, VS Code, Cursor |
| **Pris** | Gratis (beta) | $1.50-$6/1M tokens |

### Når bruke hva?

| Scenario | Anbefaling |
|----------|-----------|
| **Kompleks JIRA-analyse** | Claude Code (større kontekst, gratis) |
| **Parallelle oppgaver** | Codex (native støtte) |
| **TDD-implementering** | Begge fungerer godt |
| **GitHub-workflows** | Codex (native integrasjon) |
| **Team-samarbeid** | Codex (Slack-integrasjon) |
| **Kostnadsbevisst** | Claude Code (gratis i beta) |

---

## Neste steg

1. ✅ Installer Codex CLI
2. ✅ Autentiser med OpenAI API-nøkkel
3. ✅ Kopier custom instructions
4. ✅ Test med en enkel JIRA-sak
5. ✅ Les [docs/AI_ASSISTERT_UTVIKLING.md](../../docs/AI_ASSISTERT_UTVIKLING.md) for full dokumentasjon

---

## Headless Mode (Automatisering)

Codex CLI støtter headless mode via `codex exec` for automatisering, CI/CD og scripting.

### Grunnleggende bruk

```bash
# Kjør enkelt prompt uten interaktiv UI
codex exec "Analyser denne koden og foreslå forbedringer"

# Output siste melding til fil
codex exec "List alle TypeScript-filer" --output-last-message result.txt

# JSONL output for programmatisk parsing
codex exec "Kjør alle tester" --format jsonl
```

### E2E Testing

```bash
# Test at Codex CLI fungerer
codex exec "Si 'hello'"

# Kjør aide-workflow headless
codex exec "/aide-opprett PROJ-TEST"
```

### Flagg for automatisering

| Flagg | Beskrivelse |
|-------|-------------|
| `exec "prompt"` | Headless mode - kjør uten interaktiv UI |
| `--output-last-message <fil>` | Skriv siste melding til fil |
| `--format jsonl` | JSONL output for parsing |

**Merk:** Autentisering kan være utfordrende i headless miljøer (krever OAuth flow).

---

## Ressurser

**Offisiell dokumentasjon og best practices:**

- [OpenAI API Documentation](https://platform.openai.com/docs) - Fullstendig API-dokumentasjon
- [OpenAI Best Practices](https://platform.openai.com/docs/guides/best-practices) - Offisielle best practices
- [OpenAI Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering) - Prompt-teknikker

**Headless mode og CLI:**

- [Codex CLI - OpenAI Developers](https://developers.openai.com/codex/cli) - CLI-dokumentasjon
- [Codex GitHub](https://github.com/openai/codex) - Open source repo

---

**Lykke til med OpenAI Codex!**
