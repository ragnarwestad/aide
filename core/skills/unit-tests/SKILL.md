---
name: unit-tests
description: >-
  Prosjekt-uavhengig: analyser en fil og opprett manglende enhetstester. Detekter
  prosjektets test-oppsett (runner, kommando, stil), skriv happy/edge/error-tester som
  matcher eksisterende stil, kjør dem og rapporter dekning.
  Use when: skal generere manglende enhetstester for en fil, skal øke testdekning i et
  hvilket som helst prosjekt.
  Do NOT use for: TDD-implementering av ny funksjonalitet (egen flyt), E2E-tester (bruk
  `playwright-e2e`), ren kode-review. For Melosys-spesifikk stil (RTL/MockK/«frontend
  kodestandard»): bruk `aide-lag-tester`.
argument-hint: "[fil-path]"
effort: high
---

# Lag manglende enhetstester (generisk)

Analyser én fil og opprett comprehensive enhetstester for den. Skillen er
**prosjekt-uavhengig**: den antar ikke en bestemt runner eller stil, men detekterer
prosjektets oppsett og følger det.

**Input:** `$ARGUMENTS` = fil-path som skal testes. Mangler den, vis:

```text
Mangler fil-path

Bruk: /unit-tests <fil-path>
Eks:  /unit-tests src/core/geo.ts
```

## Steg 0 — Detekter prosjektets test-oppsett FØRST

**ALDRI skriv tester før du vet hvordan prosjektet tester.** Kartlegg:

1. **Runner + kommando:** Se `package.json` scripts (eller `pyproject.toml`/`go.mod`/
   `Cargo.toml`…). Finn test- og coverage-kommandoen prosjektet faktisk bruker. Vanlige:

   | Stack | Kjør én fil | Coverage |
   |-------|-------------|----------|
   | Vitest | `pnpm test -- --run <fil>` | `pnpm test -- --coverage` |
   | Jest | `npx jest <fil>` | `npx jest --coverage` |
   | Mocha | `npx mocha <fil>` | `npx nyc mocha` |
   | node:test | `node --test <fil>` | `node --test --experimental-test-coverage` |
   | Pytest | `pytest <fil>` | `pytest --cov` |
   | Go | `go test ./...` | `go test -cover ./...` |

   Bruk **prosjektets** script (f.eks. `pnpm test`), ikke et antatt. Kjør alltid i
   **ikke-watch / engangs-modus** så prosessen avslutter (Vitest: `--run`).
2. **Plassering + navngiving:** Ligger tester ved siden av kilden (`x.test.ts`) eller i en
   egen mappe (`__tests__/`, `tests/`)? Hvilket suffiks (`.test.`/`.spec.`/`_test`)?
3. **Stil:** Les 1–2 eksisterende testfiler. Noter assertion-stil (`expect`/`assert`/…),
   mock-mekanisme (`vi.mock`/`jest.mock`/fakes/DI), og struktur (`describe`/`it` vs flatt).
4. **Hva er testbart:** Rene funksjoner/moduler er hovedmålet. Er filen en
   ramverk-UI-komponent, bruk prosjektets komponent-test-lib (React Testing Library,
   Vue Test Utils, …) **hvis** den finnes — ikke innfør en ny. Tester ikke filen noe
   meningsfullt isolert (kun wiring/side-effekter), si fra heller enn å lage skinn-tester.

**Hovedregel:** Nye tester skal se ut som de som allerede er der.

## Arbeidsflyt

### Steg 1 — Analyser filen
- Les fila. Identifiser alle eksporterte enheter (funksjoner/klasser/moduler).
- Finn eksisterende testfil. Kartlegg hva som allerede er dekket → **gaps**.

### Steg 2 — Skriv testene
For hver utestede enhet, dekk:
- **Happy path** — normale, forventede input.
- **Edge cases** — `null`/`undefined`, tomt/grense (0, tom liste, lange strenger,
  negative tall), Unicode, antimeridian/wraparound — det som er relevant for nettopp denne koden.
- **Error cases** — ugyldig input, kastede feil, avviste promises.

Følg prosjektets stil (Steg 0.3). Bruk eksisterende test som mal.

### Steg 3 — Kjør og verifiser
- Kjør de nye testene med prosjektets kommando (engangs-modus). Fiks til alt er grønt.
- Kjør så **hele** suiten for å fange regresjoner.

### Steg 4 — Dekning
- Har prosjektet en coverage-kommando, kjør den. Vis før/etter + antall nye tester.

**Stopp og be om bekreftelse:** etter at testene er skrevet (før kjøring) og etter kjøring
(før commit) — i tråd med brukerens testing-disiplin.

## Prinsipper

- **Test atferd/kontrakt, ikke implementasjon** — asserter på utdata og effekter, ikke
  private detaljer. Da overlever testene en refaktorering.
- **Arrange–Act–Assert**, ett konsept per test, beskrivende testnavn som sier hva som forventes.
- **Deterministisk:** ingen ekte tid/nettverk/tilfeldighet. Mock eksterne avhengigheter
  ved grensen (API, klokke, `localStorage`, filsystem) — frys det som ellers varierer.
- **Test-the-tests:** en test som ikke kan feile er verdiløs. Overbevis deg om at den ryker
  hvis atferden brytes.
- **Ikke test tredjeparts-kode** eller trivielle getters; bruk innsatsen på reell logikk.
- **Kirurgisk:** legg til tester, ikke rør produksjonskoden med mindre du finner en ekte
  bug — da nevner du den separat før du eventuelt fikser.

## Forventet output (skisse)

```text
Test-analyse for <fil>:
  Enheter: N (M mangler tester)
  Nye tester: K  (happy / edge / error)
  Kjøring: K/K passerer · full suite grønn
  Coverage: <før> → <etter>
Forslag til commit-melding følger prosjektets git-konvensjon.
```
