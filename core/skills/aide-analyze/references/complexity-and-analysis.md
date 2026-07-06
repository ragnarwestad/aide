# Kompleksitetsdeteksjon og analysemønstre

## Klassifisering

| Faktor | LAV | MIDDELS | HØY |
|--------|-----|---------|-----|
| Antall filer | 1-2 | 3-10 | 10+ |
| Operasjon | fjern/erstatt/rett | refaktorer/forbedre | migrer/oppgrader |
| Keywords | spesifikk fil nevnt | én komponent/modul | "alle", "migrer", "hele" |
| API-påvirkning | ingen | mindre endringer | nye/endrede kontrakter |

Se workflows-reglene § Kompleksitetsdeteksjon for detaljer.

## Analyse per nivå

### LAV (Quick Fix, < 15 min analyse)

1. Finn den ene filen
2. Les filen, identifiser linjenummer
3. Sjekk om tester finnes
4. Dokumenter funn (< 80 linjer i 2-analysis.md)

### MIDDELS (Komponentanalyse, 20-45 min)

1. Finn hovedfilen
2. Les og identifiser avhengigheter (imports/exports)
3. Finn relaterte filer (tester, brukere av komponenten)
4. Sjekk API-påvirkning (bruk API mapping guide)
5. Dokumenter alle påvirkede filer med fil:linje (100-200 linjer)

### HØY (Bred analyse, 1-3 timer)

1. Søk bredt etter patterns i kodebasen
2. Kategoriser filer: LAV/MIDDELS/HØY kompleksitet per fil
3. Analyser ripple effects og API-påvirkning
4. Lag fasebasert migreringsplan (pilot → batch 1 → batch 2 → komplekse)
5. Dokumenter med kategorisering og migrasjonsplan (200-400 linjer)

## Eksempel: Forventet output (MIDDELS)

```text
Kodebase-analyse fullført for XX-slug

Funn:
- Kompleksitet: MIDDELS (15 filer påvirkes)
- Type: Refaktorering
- Risikonivå: Lav

Påvirkede filer (kategorisert):
LAV kompleksitet (8 filer):
- src/forms/SimpleForm.tsx:12 (< 10 felt, basic validation)
- src/forms/ContactForm.tsx:45 (enkelt skjema)

MIDDELS kompleksitet (5 filer):
- src/forms/UserProfileForm.tsx:120 (15 felt, sync validation)
- src/forms/AddressForm.tsx:89 (custom components)

HØY kompleksitet (2 filer):
- src/forms/WizardForm.tsx:234 (multi-step, FieldArray)
- src/forms/DynamicForm.tsx:456 (async validation)

Implementeringsplan opprettet:
- Fase 1: Pilot (3-5 enkle former) - 1-2 dager
- Fase 2: Batch 1 (LAV kompleksitet) - 3-5 dager
- Fase 3: Batch 2 (MIDDELS kompleksitet) - 5-7 dager
- Fase 4: Komplekse former - 2-3 dager

Filer oppdatert:
- reports/XX-slug/2-analysis.md
- reports/XX-slug/3-solution.md
- reports/XX-slug/4-status.md
```
