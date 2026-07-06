---
name: aide-analyser
description: >-
  Analyser kodebasen for en JIRA-sak eller TODO-plan.
  Detekterer kompleksitet (LAV/MIDDELS/HØY), kartlegger påvirkede filer med
  fil:linje-referanser, og oppretter implementeringsplan med TDD.
  Use when: skal analysere kodebase for en eksisterende oppgave,
  skal fylle inn 2-analyse.md og 3-løsning.md, trenger oversikt over
  påvirkede filer og API-påvirkning.
  Do NOT use for: oppretting av ny oppgave (bruk aide-opprett),
  implementering (bruk aide-løs).
disable-model-invocation: true
argument-hint: "[PROJ-XXXX eller oppgavenummer]"
effort: xhigh
---

Analyser kodebasen for en JIRA-sak eller TODO-plan.

**Input:** $ARGUMENTS (alle argumenter etter kommandoen)

## Smart deteksjon

Parse `$ARGUMENTS`:

**JIRA mode:** Hvis første ord starter med `PROJ-`
- Eksempel: `/aide-analyser PROJ-7890`

**TODO mode:** Hvis første ord er et nummer eller starter med `TODO-`
- Eksempel: `/aide-analyser 55` eller `/aide-analyser TODO-01`

**Feilhåndtering:** Hvis argument mangler eller ugyldig format, vis:

```text
Mangler argument

Bruk:
/aide-analyser PROJ-XXXX     # For JIRA-sak
/aide-analyser 55               # For oppgave (nummer)
/aide-analyser TODO-01           # For TODO-plan

Eksempler:
/aide-analyser PROJ-7890
/aide-analyser 55
```

---

## Workflow

### Steg 1: Les beskrivelse

- Les `reports/XX-slug/1-beskrivelse.md`
- Identifiser: Hva skal endres? Hvilket omfang? Migrering eller enkeltfiks?

### Steg 2: Detekter kompleksitet

Klassifiser som LAV/MIDDELS/HØY basert på antall filer, operasjonstype,
og API-påvirkning. Se `references/kompleksitet-og-analyse.md` for kriterier.

### Steg 3: Analyser kodebase

Skaler analysen etter kompleksitet:
- **LAV:** Finn filen, les den, sjekk tester. < 15 min.
- **MIDDELS:** Finn avhengigheter, relaterte filer, API-påvirkning. 20-45 min.
- **HØY:** Søk bredt, kategoriser filer, lag migreringsplan. 1-3 timer.

Se `references/kompleksitet-og-analyse.md` for detaljerte steg per nivå.

### Steg 4: Oppdater 2-analyse.md

Skriv til `reports/XX-slug/2-analyse.md`. Følg rapport-strukturen § 2-analyse.
Inkluder: Sporingsinfo, påvirkede filer med fil:linje, kompleksitet,
API-påvirkning, testdekning, risikoanalyse, estimat.

### Steg 5: Opprett implementeringsplan (3-løsning.md)

Skriv til `reports/XX-slug/3-løsning.md`. Følg rapport-strukturen § 3-løsning.
Strukturer med TDD:
- Steg 0: Skriv tester (RED phase)
- Steg 1-N: Implementering (GREEN phase)
- Testing-strategi (REFACTOR phase)

### Steg 6: Oppdater 4-status.md

Skriv til `reports/XX-slug/4-status.md`. Følg rapport-strukturen § 4-status.
- LAV: Enkel sjekkliste (< 30 linjer)
- MIDDELS/HØY: Fasebasert tracking (50-100 linjer)

### Steg 7: Bekreft

Vis oppsummering med kompleksitet, antall påvirkede filer, og neste steg.

VIKTIG:
- Bruk ALLTID fil:linje format for referanser
- Vurder ALLTID API-påvirkning (frontend ↔ backend)
- Match dokumentasjonens omfang til kompleksiteten
- Kodeblokker avsluttes ALLTID med bare ` ``` `

---

## Neste steg

```text
/aide-løs PROJ-XXXX   # For JIRA-sak
/aide-løs 55              # For oppgave (nummer)
```
