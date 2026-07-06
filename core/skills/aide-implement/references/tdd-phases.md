# TDD-faser: Detaljert workflow

## Fase 1: RED — Skriv tester som feiler

1. Les "Steg 0" fra 3-solution.md
2. Identifiser alle tester som skal skrives
3. Opprett testfiler (følg testing-reglene og frontend kodestandard)
4. Kjør: `pnpm test -- --run <testfil>`
5. Verifiser at tester FEILER (forventet!)
6. **STOPP** — be bruker om bekreftelse

Vis:
- Antall tester skrevet
- Alle feiler som forventet
- "Klar for GREEN phase?"

## Fase 2: GREEN — Implementer til tester passerer

For hvert steg i 3-solution.md:

1. Les steget
2. Implementer koden (følg kodestandard)
3. Kjør: `pnpm test -- --run <testfil>`
4. Verifiser at relevante tester PASSERER
5. Gjenta for alle steg

Når alle steg er implementert:
6. **STOPP** — be bruker om bekreftelse

Vis:
- Antall steg implementert
- Alle tester passerer
- "Klar for REFACTOR phase?"

## Fase 3: REFACTOR — Kvalitetssjekk og cleanup

```bash
# 1. Full test-suite (ingen regresjoner)
pnpm test -- --run

# 2. TypeScript (ingen type-feil)
npx tsc --noEmit

# 3. ESLint (ingen linting-feil)
pnpm run eslint

# 4. Bygg (bygget lykkes)
pnpm run build
```

Etter alle sjekker:
5. Oppdater `reports/XX-slug/4-status.md`
6. Vis oppsummering og bekreft ferdig

## Forventet output per fase

### Etter RED:

```text
FASE 1: RED PHASE — FERDIG

Testfiler opprettet:
- src/__tests__/UserProfile.test.tsx (3 testcases)
- src/__tests__/UserForm.test.tsx (2 testcases)

Status: 5/5 tester feiler (forventet i RED phase)

STOPP: Klar for GREEN phase?
```

### Etter GREEN:

```text
FASE 2: GREEN PHASE — FERDIG

Implementering fullført:
- Steg 1: Lagt til validering i UserProfile.tsx:45
- Steg 2: Lagt til felt i UserForm.tsx:120

Status: 7/7 tester passerer

STOPP: Klar for REFACTOR phase?
```

### Etter REFACTOR:

```text
FASE 3: REFACTOR PHASE — FERDIG

Full test-suite: 134 passed
TypeScript check: No errors
ESLint: No errors
Bygg: Success

IMPLEMENTERING FULLFØRT!
```
