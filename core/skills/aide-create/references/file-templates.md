# Fil-templates for oppgavedokumentasjon

Plassholdere: TITLE=tittel, FOLDER=NN-slug, DATE=dagens dato, DESC=beskrivelse

## 0-README.md

```markdown
# Dokumentasjon

**Innholdsfortegnelse:**

1. [Beskrivelse](1-description.md) - Sporingsinfo, mål, omfang, akseptansekriterier
2. [Analyse](2-analysis.md) - Funn, kompleksitet, risikoanalyse
3. [Løsning](3-solution.md) - Implementeringsplan med TDD
4. [Status](4-status.md) - Fremdriftssporing
```

## 1-description.md (fyll inn alle felter)

Struktur - følg `rapport-strukturen` § 1-description:

- `# TITLE - Beskrivelse`
- TOC med: Sporingsinfo, Beskrivelse, Omfang, Akseptansekriterier
- **Sporingsinfo:** Oppgave=`FOLDER/`, Opprettet=`DATE`
- **Beskrivelse:** DESC + redigerbar-notis
- **Omfang:** `[fylles av /aide-analyze]` for berørte filer, estimat, systemer
- **Akseptansekriterier:** `[Fylles av /aide-analyze basert på kodebase-analyse]`

## 2-analysis.md (placeholder - fylles av /aide-analyze)

Struktur - følg `rapport-strukturen` § 2-analysis:

- `# TITLE - Analyse`
- TOC med: Sporingsinfo, Omfang, Kompleksitet, Funn, Risikoanalyse
- **Sporingsinfo:** Oppgave=`FOLDER/`, Sist analysert=`[ikke analysert ennå]`
- **Omfang:** Placeholder for antall filer, kartlegging, berørte filer (nummerert liste)
- **Kompleksitet:** Placeholder for nivå, faktorer, estimat (manuell + AI-assistert)
- **Funn:** Seksjoner for kodebase-analyse, berørte komponenter, mønstre, test-dekning, API-avhengigheter
- **Risikoanalyse:** Placeholder for risikoer med konsekvens/sannsynlighet/mitigering

## 3-solution.md (placeholder - fylles av /aide-analyze)

Struktur - følg `rapport-strukturen` § 3-solution:

- `# TITLE - Løsning`
- TOC med: Sporingsinfo, Tilnærminger, Anbefalt løsning, Implementeringsplan, Testing
- **Sporingsinfo:** Oppgave=`FOLDER/`, Sist oppdatert=`[ikke utarbeidet ennå]`
- **Tilnærminger:** Placeholder for 2 tilnærminger med fordeler/ulemper/estimat
- **Anbefalt løsning:** Placeholder med før/etter-eksempler (SEPARATE kodeblokker)
- **Implementeringsplan:** TDD Red-Green-Refactor med 4 faser og checkbox-lister
- **Testing:** Seksjoner for unit, integration, e2e, manual testing

## 4-status.md (placeholder - fylles av /aide-analyze)

Struktur - følg `rapport-strukturen` § 4-status:

- `# TITLE - Status`
- Total fremgang: `0% (0 av X fullført)`, Estimat: `[X timer/dager]`
- TOC med: Sporingsinfo, Fase 1-4, Notasjon
- **Sporingsinfo:** Oppgave=`FOLDER/`, Sist oppdatert=`[ikke startet]`
- **Fase 1-4:** RED/GREEN/GREEN/REFACTOR faser med tabeller (Oppgave|Status|Notater)
- **Notasjon:** Ikke startet, Under arbeid, Fullført, Blokkert, Venter
