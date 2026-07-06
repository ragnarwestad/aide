# Reports

Denne mappen inneholder AI-genererte rapporter og analyse-dokumentasjon.

## 📁 Struktur

```text
reports/
├── jira/           # JIRA-saker (generert av /aide-opprett, /aide-analyser)
│   └── PROJ-XXXX/
│       ├── README.md           # Inngangsport med leserekkefølge
│       ├── 1-beskrivelse.md    # JIRA-metadata + problembeskrivelse
│       ├── 2-analyse.md        # Kodebase-analyse
│       ├── 3-løsning.md        # Implementeringsplan (TDD)
│       └── 4-status.md         # Fremdriftssporing
│
└── todo/           # TODO-planer (generert av /aide-opprett, /aide-analyser)
    ├── 01-redux-form-migration/
    │   ├── README.md           # Inngangsport med leserekkefølge
    │   ├── 1-beskrivelse.md    # Overordnet beskrivelse
    │   ├── 2-analyse.md        # Kodebase-analyse + estimater
    │   ├── 3-løsning.md        # Migreringsplan
    │   └── 4-status.md         # Fremdriftssporing
    └── 17-stegvelger-analyse/
        └── ...
```text

## 🎯 Forskjell mellom JIRA og TODO

| Aspekt       | JIRA-saker                                       | TODO-planer                        |
|--------------|--------------------------------------------------|------------------------------------|
| **Kilde**    | JIRA API (ekstern)                               | Manuelt opprettet                  |
| **Omfang**   | Spesifikk feature/bug                            | Større migrering/forbedring        |
| **Workflow** | `/aide-opprett` → `/aide-analyser` → `/aide-løs` | `/aide-opprett` → `/aide-analyser` |

## 📚 Dokumentasjonsstandarder

Se [../core/docs/DOCUMENTATION_STANDARD.md](../core/docs/DOCUMENTATION_STANDARD.md) for komplett dokumentasjonsstandard.

**Begge følger samme 5-fil struktur:**
1. `README.md` - Inngangsport (lenker til filer i riktig leserekkefølge)
2. `1-beskrivelse.md` - Inngang (problem, omfang, akseptansekriterier)
3. `2-analyse.md` - Detaljert analyse (funn, kompleksitet, risiko)
4. `3-løsning.md` - Implementeringsplan (TDD-tilnærming)
5. `4-status.md` - Fremdrift (⬜ 🔄 ✅ ❌ ⚠️)

## 🔄 Arbeidsflyt

### JIRA-saker

```bash
# 1. Opprett dokumentasjon
/aide-opprett PROJ-XXXX

# 2. Analyser kodebase
/aide-analyser PROJ-XXXX

# 3. Implementer løsning (TDD-assistert)
/aide-løs PROJ-XXXX
```text

### TODO-planer

```bash
# 1. Opprett beskrivelse.md manuelt
/aide-opprett "Tittel" "Detaljert beskrivelse"

# 2. Analyser kodebase
/aide-analyser 17
```text

## 📍 Hvor er verktøyene?

Rapporter er **OUTPUT** - verktøyene ligger andre steder:

- **Workflows & Templates:** `../core/` (INPUT)

- **AI-implementasjoner:** `../implementations/` (INPUT)

---

**💡 Tip:** Denne mappen inneholder kun rapporter. AI-workflows og agents finnes i `../implementations/`.
