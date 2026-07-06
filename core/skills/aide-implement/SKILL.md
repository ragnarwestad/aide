---
name: aide-implement
description: >-
  Implementer løsningen for en JIRA-sak eller TODO-plan med Test-Driven
  Development (RED → GREEN → REFACTOR). Leser eksisterende analyse og plan,
  skriver tester først, implementerer, og kjører kvalitetssjekk.
  Use when: skal implementere løsning med TDD, har ferdig analyse og
  implementeringsplan, skal kode basert på 3-solution.md.
  Do NOT use for: oppretting (bruk aide-create),
  analyse (bruk aide-analyze), rene tester uten implementering (bruk aide-make-tests).
disable-model-invocation: true
argument-hint: "[PROJ-XXXX eller oppgavenummer]"
effort: high
---

Implementer løsningen for en JIRA-sak eller TODO-plan med TDD.

**Input:** $ARGUMENTS (alle argumenter etter kommandoen)

## Smart deteksjon

Parse `$ARGUMENTS`:

**JIRA mode:** Hvis første ord starter med `PROJ-`
- Eksempel: `/aide-implement PROJ-7890`

**TODO mode:** Hvis første ord er et nummer eller starter med `TODO-`
- Eksempel: `/aide-implement 55` eller `/aide-implement TODO-01`

**Feilhåndtering:** Hvis argument mangler eller ugyldig format, vis:

```text
Mangler argument

Bruk:
/aide-implement PROJ-XXXX     # For JIRA-sak
/aide-implement 55               # For oppgave (nummer)
/aide-implement TODO-01           # For TODO-plan
```

---

## Workflow

### Forberedelse

1. Les `reports/XX-slug/2-analysis.md` (påvirkede filer)
2. Les `reports/XX-slug/3-solution.md` (implementeringsplan)
3. Les relevant kodestandard (frontend eller backend)

### Fase 1: RED — Skriv tester som feiler

1. Les "Steg 0" fra 3-solution.md
2. Opprett testfiler
3. Kjør tester — verifiser at de FEILER
4. **STOPP** — be bruker om bekreftelse før GREEN

### Fase 2: GREEN — Implementer til tester passerer

1. Implementer hvert steg fra 3-solution.md
2. Kjør tester etter hvert steg
3. Verifiser at tester PASSERER
4. **STOPP** — be bruker om bekreftelse før REFACTOR

### Fase 3: REFACTOR — Kvalitetssjekk

1. Full test-suite (ingen regresjoner)
2. TypeScript check
3. ESLint
4. Bygg
5. Oppdater 4-status.md
6. Vis oppsummering — klar for commit

Se `references/tdd-phases.md` for detaljert workflow med kommandoer
og forventet output per fase.

VIKTIG:
- **STOPP** ved hver faseovergang og be om bekreftelse
- ALDRI hopp over tester
- Følg kodestandard strengt
- Kodeblokker avsluttes ALLTID med bare ` ``` `

---

## Kvalitetssjekk (frontend)

```bash
pnpm test -- --run    # Alle tester
npx tsc --noEmit      # TypeScript check
pnpm run eslint       # ESLint
pnpm run build        # Bygg
```

## Kvalitetssjekk (backend)

```bash
scripts/run-tests.sh -pl <modul> -Dtest=<TestKlasse>    # Enhetstester
scripts/run-tests.sh -pl integrasjonstest -am --integration   # Integrasjonstester
```

---

## Etter implementering

1. Test manuelt (følg testplan fra 3-solution.md)
2. Commit endringene
