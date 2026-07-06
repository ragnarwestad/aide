---
paths:
  - "**/aide-reports/**"
---

# Rapport-struktur for JIRA og TODO

## Innholdsfortegnelse

- [Oversikt](#oversikt)
- [Filstruktur](#filstruktur)
  - [1-beskrivelse](#1-beskrivelse)
  - [2-analyse](#2-analyse)
  - [3-løsning](#3-løsning)
  - [4-status](#4-status)
- [Separasjon av innhold](#separasjon-av-innhold)
- [Forskjeller JIRA vs TODO](#forskjeller-jira-vs-todo)
- [Templates](#templates)
- [Se også](#se-også)

---

## Oversikt

4 standardiserte filer per sak/plan:

```text
reports/<NN>-slug/          # flat struktur, samme for JIRA og TODO
├── 1-beskrivelse.md        # (JIRA: PROJ-nøkkel inngår i sluggen)
├── 2-analyse.md
├── 3-løsning.md
└── 4-status.md
```

**Roller:**
1. **1-beskrivelse.md** - Hovedinngang: Problem, omfang, akseptansekriterier
2. **2-analyse.md** - Detaljert analyse: Funn, kompleksitet, risiko
3. **3-løsning.md** - Implementasjonsplan med TDD-tilnærming
4. **4-status.md** - Levende dokument: Fremdrift og status

---

## Filstruktur

### 1-beskrivelse

**Formål:** Gi oversikt over saken, omfanget og akseptansekriteriene.

**Struktur:**
```markdown
# [Tittel]

## Innholdsfortegnelse

- Metadata
- Beskrivelse
- Problem
- Omfang
- Akseptansekriterier

---

## Metadata

**JIRA:** Tabell med type, status, prioritet, reporter, assignee
**TODO:** Nummer, opprettet dato, forventet varighet

---

## Beskrivelse

**Dette feltet kan redigeres manuelt for å legge til:**
- Ekstra kontekst eller presiseringer
- Spesifikke tekniske krav
- Avklaringer fra møter/diskusjoner

---

## Problem

[Beskrivelse kopiert fra JIRA eller skrevet av utvikler]

## Omfang

**Berørte filer/komponenter:** [antall fra analyse]
**Estimert arbeidsinnsats:** [tid basert på funn]

## Akseptansekriterier

[Kriterier for når saken/planen er ferdig]

```

**Nøkkelpunkter:**
- Innholdsfortegnelse for rask navigasjon
- Metadata-tabell (JIRA/TODO-spesifikk)
- Beskrivelse-seksjonen er redigerbar for manuell tilleggsinformasjon
- Problem-seksjonen kopieres direkte (ikke skriv om)
- Ingen kodeeksempler (de hører hjemme i 3-løsning.md)

---

### 2-analyse

**Formål:** Detaljert teknisk analyse av problemet.

**Struktur:**
```markdown
# [Tittel] - Analyse

## Innholdsfortegnelse

- Omfang
- Kompleksitet
- Funn
- Risikoanalyse

---

## Omfang

**Antall berørte filer/komponenter:** [tall]
**Sist analysert**: [dato]

**Berørte filer/komponenter:**
1. `fil/path.tsx:123-145` - [beskrivelse]
2. `fil/path2.tsx:67` - [beskrivelse]

## Kompleksitet

### [Høy/Middels/Lav kompleksitet]

**Estimat:**
- **Manuell utvikling:** [tid]
- **AI-assistert utvikling:** [tid]

## Funn

### Kodebase-analyse

[Detaljerte funn]

### Berørte komponenter

[Detaljert beskrivelse per fil med konkrete linjenummer]

### Test-dekning

**Eksisterende tester:** [liste]
**Manglende tester:** [gaps]

## Risikoanalyse

### [Høy/Middels/Lav risiko]

**[Risiko 1]**
- **Konsekvens:** [beskrivelse]
- **Sannsynlighet:** [Høy/Middels/Lav]
- **Mitigering:** [hvordan redusere]
```

**Nøkkelpunkter:**
- Fokuser på ANALYSE (ikke løsning)
- Inkluder konkrete filer med linjenummer
- Estimater for både manuell og AI-assistert utvikling
- Ingen implementasjonsplan eller løsningsforslag

---

### 3-løsning

**Formål:** Implementeringsplan med TDD-tilnærming.

**Struktur:**

````markdown
# [Tittel] - Løsning

## Innholdsfortegnelse

- Tilnærminger
- Anbefalt løsning
- Implementeringsplan
- Testing
- Referanser

---

## Tilnærminger

### Tilnærming 1: [Navn] (anbefalt)

**Fordeler:** [liste]
**Ulemper:** [liste]
**Estimat:** [tid]

---

## Anbefalt løsning

### Før/Etter eksempler

**Før:**
```tsx
// fil/path.tsx:123
[gammel kode]
```

**Etter:**
```tsx
// fil/path.tsx:123
[ny kode]
```

---

## Implementeringsplan

### TDD-tilnærming (Red-Green-Refactor)

### Fase 1: Skriv tester (RED)
- [ ] Oppgave 1
- [ ] Oppgave 2

### Fase 2: Implementer løsningen (GREEN)
- [ ] Oppgave 1
- [ ] Oppgave 2

### Fase 3: Verifiser (REFACTOR)
- [ ] Kjør full test-suite
- [ ] Sjekk for regresjoner

---

## Testing

### Unit tests
[Testningstrategi]

### Manual testing
[Hva må testes manuelt]

---

## Referanser

- 1-beskrivelse.md - Problembeskrivelse
- 2-analyse.md - Analyse og funn
````

**Nøkkelpunkter:**
- Tilnærminger med fordeler/ulemper
- Før/Etter i SEPARATE kodeblokker (unngår redeclaration-feil)
- TDD-tilnærming med RED-GREEN-REFACTOR faser

---

### 4-status

**Formål:** Levende dokument som oppdateres underveis.

**Struktur:**
```markdown
# [Tittel] - Status

**Total fremgang:** X% (Y av Z fullført)
**Estimat:** [tid]

## Innholdsfortegnelse

- Fase 1: Navn
- Fase 2: Navn
- Notasjon

---

## Fase 1: [Navn]

| Oppgave | Status | Notater |
|---------|--------|---------|
| Oppgave 1 | ⬜ | [notater] |
| Oppgave 2 | 🔄 | [notater] |
| Oppgave 3 | ✅ | [notater] |

---

## Notasjon

| Symbol | Betydning |
|--------|-----------|
| ⬜ | Ikke startet |
| 🔄 | Under arbeid |
| ✅ | Fullført |
| ❌ | Blokkert |
| ⚠️ | Venter |
```

**Nøkkelpunkter:**
- Total fremgang øverst
- Organisert i faser (matcher 3-løsning.md)
- Tabellformat for oversiktlighet
- Oppdateres kontinuerlig

---

## Separasjon av innhold

| Innhold                    | Plassering        |
|----------------------------|-------------------|
| Problembeskrivelse         | 1-beskrivelse.md  |
| Metadata                   | 1-beskrivelse.md  |
| Akseptansekriterier        | 1-beskrivelse.md  |
| Kartlegging/funn           | 2-analyse.md      |
| Kompleksitetsanalyse       | 2-analyse.md      |
| Risikoanalyse              | 2-analyse.md      |
| Tilnærminger               | 3-løsning.md      |
| Før/etter eksempler        | 3-løsning.md      |
| Implementeringsplan        | 3-løsning.md      |
| Testing-strategi           | 3-løsning.md      |
| Fremdrift                  | 4-status.md       |

---

## Forskjeller JIRA vs TODO

JIRA-saker og TODO-planer har **identisk struktur**, men forskjeller i innhold:

| Aspekt          | JIRA-saker                    | TODO-planer           |
|-----------------|-------------------------------|-----------------------|
| **Lokasjon**    | `reports/<NN>-PROJ-XXXX-slug/` | `reports/<NN>-slug/`  |
| **Kilde**       | JIRA API (ekstern)            | Manuelt opprettet     |
| **Beskrivelse** | Kopieres fra JIRA             | Skrives av utvikler   |
| **Metadata**    | JIRA-felt (type, status, etc.)| Nummer, dato          |

**Felles:**
- 4 filer: 1-beskrivelse.md, 2-analyse.md, 3-løsning.md, 4-status.md
- Samme struktur og formattering
- Samme notasjon (⬜ 🔄 ✅ ❌ ⚠️)
- Samme TDD-tilnærming i 3-løsning.md

---

## Templates

AI-verktøy oppretter dokumentasjon direkte basert på strukturen beskrevet i dette dokumentet.

Kommandoen `/aide-opprett` oppretter 4-fils strukturen med riktige plassholdere.
Kommandoen `/aide-analyser` fyller inn analyse, løsning og status.

---

## Se også

- [DOCUMENTATION_STANDARD.md](./DOCUMENTATION_STANDARD.md) - Generelle dokumentasjonsregler
- [MARKDOWN_LINTING.md](./MARKDOWN_LINTING.md) - Markdown linting-regler
