---
name: aide-to-html
description: >-
  Generer HTML fra JIRA eller TODO dokumentasjon.
  Use when: skal eksportere dokumentasjon til HTML, skal generere lesbar rapport.
  Do NOT use for: PDF-generering (bruk aide-to-pdf), oppretting av dokumentasjon (bruk aide-opprett)
disable-model-invocation: true
argument-hint: "[ISSUE_ID]"
effort: medium
---

Du skal hjelpe brukeren med å **generere HTML** fra JIRA eller TODO dokumentasjon.

## Input

Brukeren har kjørt:
```bash
/aide-to-html <ISSUE_ID>
```

**Eksempler:**
- `/aide-to-html PROJ-7637` - JIRA-sak
- `/aide-to-html 17-fikse-validering` - TODO-plan
- `/aide-to-html TODO-28` - TODO shorthand

## Din oppgave

1. **Valider input:**
   - Hvis input matcher `PROJ-<tall>`: JIRA-sak (nøkkelen er en del av sluggen)
   - Hvis input er kun et tall (`NN`): nummer-shorthand
   - Alt annet: full mappe-ID (`NN-slug`)
   - Hvis ingen input: Spør brukeren om nummer eller full ID

2. **Bestem REPORTS_ROOT:**
   ```bash
   # Sjekk environment variable først
   if [ -n "$AIDE_REPORTS_PATH" ]; then
     REPORTS_ROOT="$AIDE_REPORTS_PATH"
   else
     # Fallback - anta reports/ finnes i current working directory
     REPORTS_ROOT="reports"
   fi
   ```

3. **Resolve til full mappe-ID** (flat struktur: alt ligger som `<NN>-slug/` direkte under REPORTS_ROOT):
   ```bash
   if echo "$INPUT" | grep -qE '^PROJ-[0-9]+$'; then
     # JIRA: finn mappa som inneholder nøkkelen
     DIR=$(find "$REPORTS_ROOT" -maxdepth 1 -type d -name "*${INPUT}*" | head -1 | xargs basename)
   elif echo "$INPUT" | grep -qE '^[0-9]+$'; then
     # Nummer-shorthand: finn <NN>-*
     NN=$(printf '%02d' "$INPUT")
     DIR=$(find "$REPORTS_ROOT" -maxdepth 1 -type d -name "${NN}-*" | head -1 | xargs basename)
   else
     # Anta full mappe-ID
     DIR="$INPUT"
   fi

   if [ -z "$DIR" ] || [ ! -d "$REPORTS_ROOT/$DIR" ]; then
     echo "Fant ingen sak for: $INPUT"
     exit 1
   fi
   # Eksempel: 27 → finner 27-steg-ts-konvertering-analyse
   ```

4. **Sjekk at dokumentasjon eksisterer:**
   - `$REPORTS_ROOT/<NN-slug>/` (flat struktur for både JIRA og TODO)
   - Hvis ikke: Informer at brukeren må kjøre `/aide-opprett` først

5. **Generer HTML:**
   ```bash
   # Pass den resolverte mappe-ID-en (full NN-slug) til scriptet
   aide-generate-html "$DIR"
   ```

   **VIKTIG:** `aide-generate-html` scriptet trenger også å respektere `AIDE_REPORTS_PATH`!

   Scriptet vil:
   - Kombinere alle markdown-filer (1-beskrivelse, 2-analyse, 3-løsning, 4-status)
   - Konvertere markdown til HTML
   - Legge til sticky navigasjon i header
   - Style med moderne CSS
   - Output: `$REPORTS_ROOT/<NN-slug>/<NN-slug>.html`

6. **Gi brukeren resultatet:**
   - Vis path til HTML-filen
   - Forklar hvordan åpne den: `open <path>`

## Feilhåndtering

**Hvis `npx` ikke er installert:**
```text
npx er ikke installert

Installer Node.js som inkluderer npx
```

**Hvis dokumentasjon ikke eksisterer:**
```text
Kunne ikke finne dokumentasjon for <ISSUE_ID>

Har du kjørt opprett-kommandoen først?

/aide-opprett <ISSUE_ID>
/aide-analyser <ISSUE_ID>
```

## Fordeler med HTML

- Fungerende navigasjonslenker (garantert)
- Sticky header med navigasjon
- Bedre styling-kontroll
- Søkbar i nettleser (Cmd+F)
- Responsiv (fungerer på mobil)
- Lettere og raskere enn PDF

## Notater

- **Automatisk JIRA/TODO deteksjon:** Samme logikk som `/aide-opprett`
- **Output-lokasjon:** Samme mappe som markdown-filene (holder alt samlet)
- **AIDE_REPORTS_PATH:** Scriptet respekterer environment variable hvis satt
- **Styling:** Modern, ren design med sticky navigasjon
