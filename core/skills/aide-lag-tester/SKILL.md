---
name: aide-lag-tester
description: >-
  Analyser en fil og opprett manglende enhetstester.
  Use when: skal generere manglende tester for en spesifikk fil, skal øke testdekning.
  Do NOT use for: TDD-implementering (bruk aide-løs), kode-review
disable-model-invocation: true
argument-hint: "[fil-path]"
effort: high
---

Analyser en fil og opprett manglende enhetstester.

**Input:** $ARGUMENTS (fil-path som skal analyseres)

## Argument-parsing

Parse `$ARGUMENTS`:

**Fil-path modus:**
- Eksempel: `/aide-lag-tester src/utils/land.ts`
- Analyser filen og opprett manglende tester

**Feilhåndtering:** Hvis argument mangler eller ugyldig format, vis:
```text
Mangler fil-path

Bruk:
/aide-lag-tester <fil-path>

Eksempler:
/aide-lag-tester src/utils/land.ts
/aide-lag-tester src/components/UserProfile.tsx
/aide-lag-tester src/api/userService.ts
```

---

# Prompt: Lag manglende enhetstester

**Formål:** Analyser en fil og opprett comprehensive enhetstester (tilsvarer `/aide-lag-tester` i Claude Code)

---



---

## Prompt

```text
Analyser filen <fil-path> og opprett manglende enhetstester:

STEG 1: ANALYSER FILEN
- Les filen: <fil-path>
- Identifiser alle eksporterte funksjoner
- Sjekk eksisterende testfil (f.eks. <fil-path>.test.ts)
- Identifiser gaps i testdekningen

STEG 2: SKRIV COMPREHENSIVE TESTER
For hver funksjon som mangler tester:
- Happy path (normale scenarioer)
- Edge cases (grensetilfeller)
- Error cases (feilhåndtering)

STEG 3: KJØR TESTER OG VERIFISER
- Kjør: pnpm test -- --run <testfil>
- Verifiser at alle nye tester passerer
- Fikse eventuelle feil

STEG 4: GENERER COVERAGE-RAPPORT
- Kjør: pnpm test -- --coverage <fil-path>
- Vis før/etter testdekning
- Oppsummer antall tester opprettet

VIKTIG REGLER:
- Følg frontend kodestandard for test-stil
- Følg testing-reglene for TDD-prinsipper
- Bruk Vitest for unit tests
- Bruk React Testing Library for React-komponenter
- Bruk MockK-lignende patterns for mocking

STOPP OG BE OM BEKREFTELSE:
- Etter testene er skrevet (før kjøring)
- Etter testene er kjørt (før commit)

Referanse:
- testing-reglene
- frontend kodestandard → Testing-seksjon
```

---

## Eksempel

```text
Analyser filen src/utils/land.ts og opprett manglende enhetstester:

[... følg stegene over ...]
```

---

## Forventet output

```text
Test-analyse fullført for src/utils/land.ts

Funksjoner analysert: 5
- sortLand() - HAR tester
- getLandByCode() - MANGLER tester
- formatLandnavn() - MANGLER tester
- isEULand() - HAR tester
- getEULandListe() - MANGLER tester

Nye tester opprettet: 15
- getLandByCode() - 6 tester (happy path + edge cases + errors)
- formatLandnavn() - 4 tester
- getEULandListe() - 5 tester

Test-resultat:
  15/15 tester passerer

Coverage:
  Før:  65% (11/17 funksjoner)
  Etter: 95% (16/17 funksjoner)
  Økning: +30%

Neste steg:
Commit endringene med melding:
"La til manglende enhetstester for land.ts

- getLandByCode: 6 tester (happy path, edge cases, errors)
- formatLandnavn: 4 tester
- getEULandListe: 5 tester
- Coverage økt fra 65% til 95%"
```

---

## Tips

- Start med de enkleste funksjonene først
- Bruk eksisterende tester som mal for stil
- Test edge cases: null, undefined, tomme arrays, lange strenger
- Mock eksterne avhengigheter (API-kall, localStorage, etc.)
- Verifiser at tester faktisk feiler hvis koden endres (test the tests!)


---

## Etter testgenerering

**Verifiser:**
```bash
pnpm test -- --run <testfil>     # Kjør de nye testene
pnpm test -- --coverage          # Se coverage-rapport
```

**Neste steg:**
- Commit testene med beskrivende melding
- Vurder om flere filer trenger tester
