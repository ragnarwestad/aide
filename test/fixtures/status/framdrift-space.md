# Kobling mot treningsklokker — Status

**Total framdrift:** 0 % (0 av 18 ferdig)
**Estimat:** 6–10 timer med AI-assistanse (etappe 1)

## Innholdsfortegnelse

- [Sporingsinfo](#sporingsinfo)
- [Fase 1: RED](#fase-1-red)
- [Fase 2: GREEN — lagringen](#fase-2-green--lagringen)
- [Fase 3: GREEN — visningen](#fase-3-green--visningen)
- [Fase 4: REFACTOR](#fase-4-refactor)
- [Notasjon](#notasjon)

---

## Sporingsinfo

- **Oppgave:** `01-kobling-mot-treningsklokker/`
- **Sist oppdatert:** `2026-08-15`

**Ikke startet.** Planen dekker etappe 1 — at PaceUp husker en
gjennomført økt. Etappe 2, koblingen utad, venter på at retningen velges.

---

## Fase 1: RED

| Oppgave | Status | Merknad |
| --------- | -------- | --------- |
| `runSummary.test.ts` — kriterium 1 og 4 | ⬜ | Varighet og antall øvelser |
| `RoutineRunner.test.tsx` — kriterium 2, 3 og 7 | ⬜ | Én lagring, avbrudd, feil |
| `supabase/tests/runs.test.sql` — kriterium 6 | ⬜ | Admin ser ikke andres økter |
| Se testene feile av riktig grunn | ⬜ | |

---

## Fase 2: GREEN — lagringen

| Oppgave | Status | Merknad |
| --------- | -------- | --------- |
| Migrasjon: tabellen `runs` og tilgangsregel | ⬜ | Kjøres for hånd, før koden |
| `src/types.ts`: `CompletedRun` | ⬜ | |
| `runSummary.ts`: `summarizeRun()` | ⬜ | Regelen bor her |
| `src/hooks/useRuns.ts` | ⬜ | `saveRun`, `runs`, `deleteRun` |
| Lagring ved overgang til `isComplete` | ⬜ | Med vakt mot dobbeltlagring |

---

## Fase 3: GREEN — visningen

| Oppgave | Status | Merknad |
| --------- | -------- | --------- |
| `src/components/history/` | ⬜ | Historikkside og liste |
| Rute og menypunkt | ⬜ | `App.tsx` og `components/app/` |
| Tekster på nb, en og es | ⬜ | |
| Kriterium 5: navnet står etter sletting | ⬜ | `on delete set null` |

---

## Fase 4: REFACTOR

| Oppgave | Status | Merknad |
| --------- | -------- | --------- |
| `pnpm build` | ⬜ | ESLint, TypeScript, bygg |
| `pnpm test -- --run` | ⬜ | Hele suiten |
| `pnpm test:e2e` | ⬜ | Hele suiten |
| Reverter lagringen, se kriterium 1 gå rødt | ⬜ | Beviser at testen er verdt å ha |
| Oppdater `docs/SPEC.md` | ⬜ | Historikk inn i datamodellen |

---

## Notasjon

| Symbol | Betydning |
| -------- | ----------- |
| ⬜ | Ikke startet |
| 🔄 | Pågår |
| ✅ | Ferdig |
| ❌ | Blokkert |
| ⚠️ | Venter |
