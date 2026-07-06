# AI-verktøy referanse

Verifisert konfigurasjonsoversikt for alle AI-verktøy vi støtter.
Denne filen er kilden til sannhet — ikke gjett, slå opp her.

Sist verifisert: 2026-03-28

## Innholdsfortegnelse

- [Tverrgående standarder](#tverrgående-standarder)
- [Claude Code](#claude-code)
- [GitHub Copilot](#github-copilot)
- [OpenAI Codex CLI](#openai-codex-cli)
- [Google Gemini CLI](#google-gemini-cli)
- [Sammenligning](#sammenligning)
- [Kilder](#kilder)

---

## Tverrgående standarder

### Skills (SKILL.md)

Skills er en tverrgående standard. Alle tre verktøy leser skills fra
overlappende stier:

| Sti | Claude Code | Copilot | Codex |
|-----|:-----------:|:-------:|:-----:|
| `~/.claude/skills/<navn>/SKILL.md` | ja | ja | nei |
| `~/.copilot/skills/<navn>/SKILL.md` | nei | ja | nei |
| `~/.agents/skills/<navn>/SKILL.md` | nei | ja (v1.0.11+) | ja |
| `.claude/skills/<navn>/SKILL.md` | ja | ja | nei |
| `.github/skills/<navn>/SKILL.md` | nei | ja | nei |
| `.agents/skills/<navn>/SKILL.md` | nei | ja | ja |

**Format:** Mappe med `SKILL.md` som inngang. YAML-frontmatter med
`name` og `description` (påkrevd). Markdown-body med instruksjoner.

**Copilot leser også `~/.claude/commands/`** som skills (oppdaget mars 2026).
Instruksjonene tolkes som naturlig-språk-oppskrift, `$ARGUMENTS` ignoreres.

**Viktig for doc-aide:** Våre skills i `~/.claude/skills/` leses av
både Claude Code og Copilot. De MÅ ha `SKILL.md`-fil med riktig
frontmatter for at Copilot skal oppdage dem.

### Instruksjonsfiler

Alle verktøy har en prosjekt-instruksjonsfil som leses automatisk:

| Verktøy | Fil | Global |
|---------|-----|--------|
| Claude Code | `CLAUDE.md` eller `.claude/CLAUDE.md` | `~/.claude/CLAUDE.md` |
| Copilot | `.github/copilot-instructions.md` | `~/.copilot/copilot-instructions.md` |
| Codex | `AGENTS.md` | `~/.codex/AGENTS.md` |
| Gemini | `GEMINI.md` | `~/.gemini/GEMINI.md` |

**Copilot leser også andres filer** (kun i Coding Agent):
`AGENTS.md`, `CLAUDE.md` og `GEMINI.md` i repo-roten.

---

## Claude Code

**Docs:** <https://code.claude.com/docs/>

### Konfigurasjonsfiler

| Fil | Sti | Formål |
|-----|-----|--------|
| CLAUDE.md | `./CLAUDE.md`, `./.claude/CLAUDE.md`, `~/.claude/CLAUDE.md` | Instruksjoner |
| settings.json | `.claude/settings.json`, `~/.claude/settings.json` | Permissions, hooks, env |
| settings.local.json | `.claude/settings.local.json` | Lokale overrides (gitignored) |
| Skills | `~/.claude/skills/<navn>/SKILL.md` | Slash commands |
| Rules | `~/.claude/rules/*.md`, `.claude/rules/*.md` | Automatisk lastede regler |
| Agents | `~/.claude/agents/*.md`, `.claude/agents/*.md` | Subagent-definisjoner |
| Commands | `~/.claude/commands/*.md` | Unified med skills (begge lager `/`-commands) |
| MCP | `~/.claude/.mcp.json`, `.claude/.mcp.json` | MCP-servere |
| Memory | `~/.claude/projects/<prosjekt>/memory/` | Auto-minne |

### Rules

Markdown-filer i `.claude/rules/` eller `~/.claude/rules/`. Valgfri
YAML-frontmatter med `paths` (glob eller YAML-liste med globs) for
sti-spesifikke regler. Uten `paths` lastes de alltid ved sesjonsstart.

### Agents

Markdown med YAML-frontmatter. Nøkkelfelt: `name`, `description`,
`tools`, `model`, `skills`, `mcpServers`, `hooks`, `memory`, `isolation`.

### Hooks

Konfigureres i settings.json. Events: `PreToolUse`, `PostToolUse`,
`UserPromptSubmit`, `Stop`, `SessionStart`, `SubagentStart`,
`CwdChanged`, `FileChanged`, `TaskCreated`, `StopFailure` m.fl.
Hook-typer: `command`, `http`, `prompt`, `agent`.
Hooks støtter `if`-felt med permission rule syntax for conditional kjøring.

### Skill/Agent frontmatter

Skills og agents støtter disse frontmatter-feltene:

| Felt | Formål |
|------|--------|
| `name` | Identifikator |
| `description` | Trigger-matching (maks ~250 tegn vist i `/skills`) |
| `effort` | Reasoning effort for skillen (low/medium/high) |
| `maxTurns` | Maks antall tur for agenten |
| `disallowedTools` | Verktøy agenten ikke har tilgang til |
| `initialPrompt` | Auto-submit første tur |
| `paths` | YAML-liste med globs for sti-spesifikk aktivering |

---

## GitHub Copilot

**Docs:** <https://docs.github.com/en/copilot>

### Konfigurasjonsfiler

| Fil | Sti | Formål |
|-----|-----|--------|
| Custom instructions | `.github/copilot-instructions.md` | Repo-wide instruksjoner |
| Path-specific | `.github/instructions/*.instructions.md` | Sti-spesifikke regler |
| Global instructions | `~/.copilot/copilot-instructions.md` | Personlige instruksjoner |
| Skills | `~/.claude/skills/`, `~/.copilot/skills/`, `~/.agents/skills/`, `.github/skills/` | SKILL.md-baserte skills |
| Custom agents | `.github/agents/*.md` | Agent-definisjoner |
| CLI config | `~/.copilot/config.json` | CLI-konfigurasjon |
| VS Code settings | `.vscode/settings.json` | IDE-konfigurasjon |
| Coding Agent env | `.github/workflows/copilot-setup-steps.yml` | CI-miljø for Coding Agent |

### Path-specific instructions

Filer i `.github/instructions/` med `.instructions.md`-endelse.
Krever YAML-frontmatter med `applyTo`-glob:

```yaml
---
applyTo: "**/*.ts,**/*.tsx"
---
```

### Custom agents

Filer i `.github/agents/*.md`. YAML-frontmatter med `name`,
`description`, `tools`, `model`, `mcp-servers`.

### AGENTS.md-støtte

Copilot leser `AGENTS.md` i repo-roten og cwd. Støttet i:
VS Code chat, Coding Agent (alle miljøer), CLI. IKKE i JetBrains
chat, Visual Studio chat, Eclipse chat.

### Monorepo-støtte (v1.0.11+)

Fra v1.0.11 oppdager Copilot CLI skills, instruksjoner, MCP-servere
og agents på hvert katalognivå fra cwd opp til git-roten. Dette
betyr at prosjektene kan ha prosjekt-spesifikke skills i
`.github/skills/` som supplerer de globale i `~/.claude/skills/`.

### Hva Copilot IKKE leser

- `~/.claude/rules/` — kun Claude Code
- `~/.claude/agents/` — kun Claude Code
- `.claude/CLAUDE.md` — kun Coding Agent (ikke VS Code chat eller CLI)

---

## OpenAI Codex CLI

**Docs:** <https://developers.openai.com/codex/cli>
**Repo:** <https://github.com/openai/codex>

### Konfigurasjonsfiler

| Fil | Sti | Formål |
|-----|-----|--------|
| AGENTS.md | Repo-rot og nedover til cwd | Instruksjoner (directory-walk) |
| AGENTS.override.md | Samme stier | Override uten å slette AGENTS.md |
| config.toml | `~/.codex/config.toml`, `<repo>/.codex/config.toml` | Konfigurasjon |
| Skills | `~/.agents/skills/`, `.agents/skills/` | SKILL.md-baserte skills |
| hooks.json | `~/.codex/hooks.json`, `<repo>/.codex/hooks.json` | Hooks (eksperimentelt) |

### AGENTS.md

Ren Markdown. Codex walker fra git-rot ned til cwd og konkatenerer
alle AGENTS.md-filer. `AGENTS.override.md` tar presedens på hvert nivå.
Maks 32 KiB samlet (`project_doc_max_bytes`).

### config.toml

Nøkkelseksjoner: `model`, `approval_policy`, `sandbox_mode`,
`project_doc_fallback_filenames`. Støtter profiler via
`[profiles.<navn>]`.

### Plugins (v0.117.0+)

Plugins er nå førsteklasses workflow i Codex. Synces ved oppstart,
browses med `/plugins`, installeres/fjernes med auth-håndtering.
Sub-agents bruker sti-baserte adresser (`/root/agent_a`) med
strukturert inter-agent messaging.

---

## Google Gemini CLI

**Docs:** <https://geminicli.com/docs/>
**Repo:** <https://github.com/google-gemini/gemini-cli>

### Konfigurasjonsfiler

| Fil | Sti | Formål |
|-----|-----|--------|
| GEMINI.md | Cwd og oppover til git-rot, `~/.gemini/GEMINI.md` | Instruksjoner |
| settings.json | `.gemini/settings.json`, `~/.gemini/settings.json` | Konfigurasjon |
| Custom commands | `.gemini/commands/*.toml`, `~/.gemini/commands/*.toml` | Slash commands |
| MCP | settings.json `mcpServers`-seksjon | MCP-servere |

### Custom commands

TOML-format (ikke Markdown). Støtter shell-eksekvering (`!{command}`),
filinjeksjon (`@{path}`), og brukerargumenter (`{{args}}`).
Undermapper gir namespace: `git/commit.toml` → `/git:commit`.

### GEMINI.md

Konkatenerer alle GEMINI.md-filer fra cwd opp til git-rot pluss global.
Støtter `@file.md`-import for å inkludere andre filer.

---

## Sammenligning

### Instruksjoner og regler

| Funksjon | Claude Code | Copilot | Codex | Gemini |
|----------|:-----------:|:-------:|:-----:|:------:|
| Prosjekt-instruksjoner | CLAUDE.md | copilot-instructions.md | AGENTS.md | GEMINI.md |
| Sti-spesifikke regler | rules/ med paths | instructions/*.instructions.md | nei | nei |
| Directory walk | ja | nei (én fil) | ja (rot→cwd) | ja (cwd→rot) |
| Global instruksjoner | ~/.claude/CLAUDE.md | ~/.copilot/copilot-instructions.md | ~/.codex/AGENTS.md | ~/.gemini/GEMINI.md |
| Fil-import | nei | nei | nei | ja (@file.md) |

### Skills og commands

| Funksjon | Claude Code | Copilot | Codex | Gemini |
|----------|:-----------:|:-------:|:-----:|:------:|
| Skills (SKILL.md) | ja | ja | ja | nei |
| Custom commands | unified med skills (.md) | nei | nei | ja (.toml) |
| Slash commands | /skill-name | /skill-name | /skill-name | /command-name |
| Auto-aktivering | ja (description match) | ja | ja | nei |

### Konfigurasjon

| Funksjon | Claude Code | Copilot | Codex | Gemini |
|----------|:-----------:|:-------:|:-----:|:------:|
| Config-format | JSON | JSON | TOML | JSON |
| Config-sti | .claude/ | .github/, .vscode/ | .codex/ | .gemini/ |
| MCP-servere | ja | ja (agents) | ja | ja |
| Hooks | ja | nei | ja (eksperimentelt) | nei |
| Agents/subagents | ja | ja (.github/agents/) | ja (v0.117+, plugins) | nei |

---

## Kilder

### Claude Code

- Docs: <https://code.claude.com/docs/>
- Memory/CLAUDE.md: <https://code.claude.com/docs/en/memory.md>
- Settings: <https://code.claude.com/docs/en/settings.md>
- Skills: <https://code.claude.com/docs/en/skills.md>
- Agents: <https://code.claude.com/docs/en/sub-agents.md>
- Hooks: <https://code.claude.com/docs/en/hooks.md>
- MCP: <https://code.claude.com/docs/en/mcp.md>

### GitHub Copilot

- Custom instructions: <https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot>
- Support matrix: <https://docs.github.com/en/copilot/reference/custom-instructions-support>
- CLI instructions: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions>
- Skills: <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills>
- CLI skills: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills>
- Custom agents: <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents>
- CLI config: <https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli>
- Coding Agent env: <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment>

### OpenAI Codex

- Docs: <https://developers.openai.com/codex/cli>
- AGENTS.md: <https://developers.openai.com/codex/guides/agents-md>
- Config: <https://developers.openai.com/codex/config-advanced>
- Skills: <https://developers.openai.com/codex/skills>
- MCP: <https://developers.openai.com/codex/mcp>
- Hooks: <https://developers.openai.com/codex/hooks>
- Repo: <https://github.com/openai/codex>

### Google Gemini CLI

- Docs: <https://geminicli.com/docs/>
- Configuration: <https://geminicli.com/docs/reference/configuration/>
- GEMINI.md: <https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html>
- Custom commands: <https://geminicli.com/docs/cli/custom-commands/>
- MCP: <https://geminicli.com/docs/tools/mcp-server/>
- Extensions: <https://geminicli.com/docs/extensions/>
- Repo: <https://github.com/google-gemini/gemini-cli>
