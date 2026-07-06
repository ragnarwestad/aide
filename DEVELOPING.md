# Utviklerguide for doc-aide

Denne guiden er for deg som vil **bidra til eller videreutvikle** doc-aide.

## Innholdsfortegnelse

- [Katalogstruktur](#katalogstruktur)
- [Legge til ny funksjonalitet](#legge-til-ny-funksjonalitet)
  - [Ny skill](#ny-skill)
  - [Oppdatere regler](#oppdatere-regler)
  - [Oppdatere Copilot-instruksjoner](#oppdatere-copilot-instruksjoner)
- [Installasjon](#installasjon)
- [Arkitektur](#arkitektur)

---

## Katalogstruktur

```text
doc-aide/
│
├── core/                          # FELLES INNHOLD (delt av alle AI-verktøy)
│   ├── skills/                    # Skills (SKILL.md per mappe)
│   │   ├── tdd-coach/
│   │   └── ...
│   ├── rules/                     # Generiske regler — installeres til ~/.claude/rules/
│   │   ├── workflows.md
│   │   ├── git.md
│   │   ├── testing.md
│   │   └── ...
│   ├── scripts/                   # CLI-scripts: aide-generate-pdf, aide-generate-html
│   └── templates/                 # Dokumentmaler
│
├── implementations/               # AI-SPESIFIKKE TILPASNINGER
│   │
│   ├── claude-code/
│   │   ├── CLAUDE.md              # Mal — installeres til .claude/CLAUDE.md i hvert prosjekt
│   │   ├── agents/                # Agent-definisjoner — installeres til ~/.claude/agents/
│   │   │   └── task-analyzer.md
│   │   ├── settings.json          # Claude Code permissions (doc-aide selv)
│   │   ├── install.sh
│   │   └── uninstall.sh
│   │
│   └── copilot/
│       ├── .github/
│       │   └── copilot-instructions.md  # Installeres til .github/ i hvert prosjekt
│       ├── keybindings.json       # VS Code keybindings (manuelt steg)
│       ├── install.sh
│       └── uninstall.sh
│
└── tests/                         # TESTER
    └── specs/
```

---

## Legge til ny funksjonalitet

### Ny skill

Alle skills (både ekspert-skills og aide-* workflow-skills) ligger i `core/skills/`.

Eksempel: Legge til `database-expert`

```bash
# 1. Opprett skill
mkdir -p core/skills/database-expert
vim core/skills/database-expert/SKILL.md

# 2. Legg til i uninstall.sh sin SKILLS-liste

# 3. Installer og test
cd implementations/claude-code && ./install.sh

# 4. Commit
git add core/skills/database-expert/
git commit -m "La til database-expert skill"
```

### Oppdatere regler

```bash
vim core/rules/workflows.md
cd implementations/claude-code && ./install.sh
```

### Oppdatere Copilot-instruksjoner

```bash
vim implementations/copilot/.github/copilot-instructions.md
cd implementations/copilot && ./install.sh
```

---

## Installasjon

```bash
# Claude Code
cd implementations/claude-code && ./install.sh

# Copilot
cd implementations/copilot && ./install.sh

# Avinstaller Claude Code
cd implementations/claude-code && ./uninstall.sh
```

---

## Arkitektur

### Hovedprinsipper

1. **Direkte kilder:** Instruksjonsfiler er direkte kildefiler — ingen byggesteg
2. **Separasjon:** Generisk innhold (`core/`) vs AI-spesifikt (`implementations/`)

### Installasjonsoversikt

| Hva | Kilde | Installeres til |
|-----|-------|-----------------|
| Skills | `core/skills/` | `~/.claude/skills/` |
| Scripts | `core/scripts/` | `~/.local/bin/` |
| Agents | `implementations/claude-code/agents/` | `~/.claude/agents/` |
| Regler | `core/rules/` | `~/.claude/rules/` |
| CLAUDE.md (mal) | `implementations/claude-code/CLAUDE.md` | `<prosjekt>/.claude/CLAUDE.md` |
| Copilot instructions | `implementations/copilot/.github/copilot-instructions.md` | `<prosjekt>/.github/copilot-instructions.md` |

### Spesialtilfeller

- **doc-aide:** `.claude/CLAUDE.md` og `.claude/settings.json` er git-tracked og overskrives aldri av install.sh
- **AI-installasjonene er globale** og gjelder alle prosjektene dine
- **aide-* skills:** Er slash commands (skills) i Claude Code/Copilot — ikke standalone CLI-scripts
