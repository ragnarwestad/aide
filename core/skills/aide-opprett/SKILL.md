---
name: aide-opprett
description: >-
  Opprett dokumentstruktur for en JIRA-sak eller TODO-plan med 4-fils
  rapportstruktur (beskrivelse, analyse, løsning, status).
  Use when: skal opprette ny oppgave, ny JIRA-sak, ny TODO-plan,
  starter nytt arbeid som trenger dokumentasjon.
  Do NOT use for: analyse (bruk aide-analyser), implementering (bruk aide-løs),
  kode-review.
disable-model-invocation: true
argument-hint: "[PROJ-XXXX eller TODO <beskrivelse>]"
effort: medium
---

Opprett dokumentstruktur for en JIRA-sak eller TODO-plan.

**Input:** $ARGUMENTS (alle argumenter etter kommandoen)

## Smart deteksjon

Parse `$ARGUMENTS`:

**JIRA mode:** Hvis første ord starter med `PROJ-`
- Eksempel: `/aide-opprett PROJ-7890`
- Tittel: JIRA-nøkkel, beskrivelse: hent fra JIRA hvis mulig

**TODO mode (med navn):** Hvis første ord starter med `TODO-` (men ikke kun `TODO`)
- Eksempel: `/aide-opprett TODO-redux-form-migration Flytt alle forms`
- Tittel: `TODO-redux-form-migration`, beskrivelse: resten av argumentene

**TODO mode (autogenerert):** Hvis første ord er kun `TODO`
- Eksempel: `/aide-opprett TODO Flytt forms til React Hook Form`
- Tittel: genereres automatisk fra beskrivelsen

**Feilhåndtering:** Hvis argument mangler eller ugyldig format, vis:

```text
Mangler argument

Bruk:
/aide-opprett PROJ-XXXX                    # For JIRA-sak
/aide-opprett TODO-<navn> <beskrivelse>       # TODO med navn
/aide-opprett TODO <beskrivelse>              # TODO autogenerert

Eksempler:
/aide-opprett PROJ-7890
/aide-opprett TODO-redux-form-migration Flytt forms fra Redux Form
/aide-opprett TODO Implementere dark mode
```

---

## Workflow

### Steg 1: Finn reports-root

- Kjør: `echo $AIDE_REPORTS_PATH`
- Hvis satt: Bruk den stien som reports-root
- Hvis IKKE satt: Bruk `reports/` i prosjektroten

### Steg 2: Finn neste ledige nummer

- List kataloger i reports-root (`ls`)
- Finn høyeste nummer fra format `NN-slug`
- Neste nummer = høyeste + 1 (eller 01 hvis ingen finnes)
- Formater med ledende null: `01`, `02`, ... `99`

### Steg 3: Generer slug fra tittel

- Lowercase, mellomrom → bindestrek
- æ→ae, ø→o, å→a
- Fjern spesialtegn og doble bindestreker
- Resultat: `NN-slug` (f.eks. `65-rydd-opp-console-log`)

### Steg 4: Opprett katalog og 5 filer

- Opprett katalog: `<reports-root>/NN-slug/`
- Opprett filene med innhold fra `references/fil-templates.md`
- Erstatt plassholdere: TITLE, FOLDER, DATE, DESC

### Steg 5: Stage i git

- Hvis `AIDE_REPORTS_PATH` er satt: HOPP OVER git add (eget repo)
- Ellers: `git add <reports-root>/NN-slug/*.md`

### Steg 6: Bekreft

Vis oppsummering og neste steg:

```text
Oppgave opprettet: 55-rydd-opp-i-console-log

Filer opprettet:
- reports/55-rydd-opp-i-console-log/0-README.md
- reports/55-rydd-opp-i-console-log/1-beskrivelse.md (ferdig utfylt)
- reports/55-rydd-opp-i-console-log/2-analyse.md (klar for analyse)
- reports/55-rydd-opp-i-console-log/3-løsning.md (klar for løsning)
- reports/55-rydd-opp-i-console-log/4-status.md (klar for status)

Neste steg: /aide-analyser 55
```

VIKTIG:
- Følg workflows-reglene - Fase 1: Oppgave-workflow
- Følg rapport-strukturen for filstruktur
- Kodeblokker avsluttes ALLTID med bare ` ``` ` — ALDRI ` ```text ` som avslutning

---

## Neste steg

```text
/aide-analyser PROJ-XXXX   # For JIRA-sak
/aide-analyser 55              # For TODO (bruk oppgavenummer)
```
