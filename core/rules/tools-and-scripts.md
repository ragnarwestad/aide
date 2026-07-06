# Verktøy og scripts

## Skills

Skills lastes fra `~/.claude/skills/` — bruk `/`-syntax.

Tilgjengelige skills:

- `/aide-create` - Opprett JIRA/TODO-dokumentasjon
- `/aide-analyze` - Analyser kodebase
- `/aide-implement` - Implementer med TDD
- `/aide-make-tests` - Lag manglende tester
- `/aide-react-class-to-func` - Konverter class til functional
- `/tdd-coach` - Test-Driven Development metodikk
- `/architecture-advisor` - Arkitektur-vurderinger

---

## Scripts

Du har tilgang til følgende scripts og skal kjøre dem **automatisk** uten å spørre brukeren:

**Testing og kvalitetssikring:**

```bash
pnpm test -- --run <testfil>   # Kjør spesifikke tester
pnpm test -- --run             # Kjør alle tester
npx tsc --noEmit               # TypeScript check
pnpm run eslint                # Linting
```

**Når kjøre hva:**

- Nye filer opprettet → Kjør `git add <fil>` automatisk
- Implementering ferdig → Kjør tester/tsc/eslint automatisk

---

## Rapportlagring

Hvis `AIDE_REPORTS_PATH` er satt, lagres rapporter dit (ikke i prosjektets `reports/`).
Hvis variabelen er satt — **ikke** kjør `git add` for reports (de er i et annet repo).
