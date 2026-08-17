# self-contained-dist - Status

## Innholdsfortegnelse

- [Sporingsinfo](#sporingsinfo)
- [Implementeringssteg](#implementeringssteg)
- [Sluttverifisering](#sluttverifisering)
- [Notasjon](#notasjon)

---

## Sporingsinfo

- **TODO:** `64-self-contained-dist`
- **Total fremgang:** 100% (9 av 9 fullført)
- **Sist oppdatert:** `2026-03-04`
- **Branch:** `main`

---

## Implementeringssteg

| Steg | Beskrivelse                                              | Status | Commit    | Notater                                                                                                                                |
|------|----------------------------------------------------------|--------|-----------|----------------------------------------------------------------------------------------------------------------------------------------|
| 1    | Fiks core/docs referanser i commands                     | ✅     | `dab4789` | Erstattet `core/docs/` med `.claude/rules/` i commands og agent                                                                        |
| 2    | Fiks systems/ referanser                                 | ✅     | `e14d431` | Erstattet `systems/` med prosjektlokale stier og system-paths.md                                                                       |
| 3    | Embed templates + generiske navn                         | ✅     | `c97239c` | Embeddet templates i aide-opprett, erstattet `.claude/rules/`-stier i `core/` med generiske navn                                       |
| 4    | Embed analysis-instructions i aide-analyser              | ✅     | `0531787` | Fjernet `core/analysis-instructions/`-avhengighet, ga git-tillatelser i settings                                                       |
| 5    | Fjern INSTALLATION_PATH fra commands/scripts             | ✅     | `fed2255` | aide-to-html/pdf commands og aide-generate-html/pdf scripts                                                                            |
| 6    | Oppdater CLAUDE.md og install.sh                         | ✅     | `801811d` | Fjernet INSTALLATION_PATH fra base.md, before.md, INSTALL.md, build-dist.py                                                            |
| 7    | Copilot - verifiser self-contained                       | ✅     | `0c69958` | Erstattet core/docs/ og systems/ i copilot after.md og tips-base.md                                                                    |
| 8    | Fiks steg 2 — installer docs og api-mapping til .claude/ | ✅     | `811c575` | build-dist.py kopierer systems/melosys-web/docs/ og api-mapping/ til .claude/docs/ og .claude/api-mapping/. SYSTEM_PATHS.md oppdatert. |
| 9    | Fiks gjenværende gamle stier i kildefiler                | ✅     | `c91c301` | docs/KODESTANDARD.md → .claude/docs/, api-mapping/ → .claude/api-mapping/ i skills og instruksjoner                                    |

---

## Sluttverifisering

Verifisert 2026-03-04 (re-verifisert etter steg 9) - alle referanser løst i installerte filer:

| Søketerm                                            | Claude Code `.claude/` | Copilot `.github/` + `prompts/` | Plugin |
|-----------------------------------------------------|------------------------|---------------------------------|--------|
| `MELOSYS_AIDE_INSTALLATION_PATH`                    | 0                      | 0                               | 0      |
| `core/docs/`                                        | 0                      | 0                               | 0      |
| `core/templates/`                                   | 0                      | 0                               | 0      |
| `../../core/`                                       | 0                      | 0                               | 0      |
| `systems/melosys-web/`                              | 0                      | 0                               | 0      |
| `docs/KODESTANDARD` (uten `.claude/`-prefiks)       | 0                      | —                               | —      |
| `api-mapping/API_MAPPING` (uten `.claude/`-prefiks) | 0                      | —                               | —      |
| `.claude/docs/KODESTANDARD.md` finnes               | ✅                     | —                               | —      |
| `.claude/api-mapping/API_MAPPING_GUIDE.md` finnes   | ✅                     | —                               | —      |

**Generisk mapping brukt:**

| Gammel referanse                    | Generisk navn              |
|-------------------------------------|----------------------------|
| `.claude/rules/workflows.md`        | `workflows-reglene`        |
| `.claude/rules/testing.md`          | `testing-reglene`          |
| `.claude/rules/git.md`              | `git-reglene`              |
| `.claude/rules/documentation.md`    | `dokumentasjonsstandarden` |
| `.claude/rules/report-structure.md` | `rapport-strukturen`       |
| `.claude/rules/markdown-linting.md` | `markdown-linting-reglene` |

---

## Notasjon

| Symbol | Betydning           |
|--------|---------------------|
| ⬜     | Ikke startet        |
| 🔄     | Under arbeid        |
| ✅     | Fullført            |
| ❌     | Blokkert            |
| ⚠️     | Venter på avklaring |

---

## Relaterte dokumenter

- [1-beskrivelse.md](./1-beskrivelse.md) - Sporingsinfo og akseptansekriterier
- [2-analyse.md](./2-analyse.md) - Analyse og kartlegging
- [3-løsning.md](./3-løsning.md) - Implementeringsplan med TDD

**Archived:** 2026-08-13
