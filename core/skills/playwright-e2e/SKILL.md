---
name: playwright-e2e
description: >-
  Prosjekt-uavhengige Playwright E2E-regler: detekter prosjektets egne konvensjoner,
  rolle-baserte locators, auto-waiting, test-isolasjon, mocking og soft assertions.
  Use when: skriver eller endrer Playwright E2E-tester i et hvilket som helst prosjekt.
  Do NOT use for: enhetstester (Vitest/Jest), manuell testing, backend-tester.
effort: medium
---

# Playwright E2E-testing (generisk)

Regler og konvensjoner for Playwright E2E-tester i et hvilket som helst prosjekt.
Skillen er **prosjekt-uavhengig**: den påtvinger IKKE én arkitektur (f.eks. POM), men
detekterer prosjektets eksisterende mønstre og følger dem, og legger på de universelle
Playwright-prinsippene som gjelder uansett.

## Steg 0 — Detekter prosjektets konvensjoner FØRST

**ALDRI hopp rett til å skrive tester.** Kartlegg først (rør ikke koden ennå):

1. **Config:** Les `playwright.config.*` — finn `testDir`, `baseURL`, `webServer.command`
   (auto-starter dev-server?), `channel`/`projects` (system-browser vs bundled), `use`-opsjoner.
2. **Kjørekommando:** Sjekk `package.json` scripts. Vanlige: `pnpm test:e2e`,
   `npm run test:e2e`, `npx playwright test`. Bruk prosjektets script, ikke et antatt.
3. **Eksisterende specs:** Les et par filer i `testDir`. Avgjør:
   - **Bruker prosjektet POM** (egen `pages/`-mappe) eller **rene spec-filer** med
     `page.getByRole(...)` direkte? → følg det som allerede er der.
   - Locator-stil, navnekonvensjoner, språk (norsk/engelsk i testnavn).
4. **Begrensninger:** Henter appen data fra nett/CDN ved kjøring? Da skal testene være
   **offline-safe** — assert på statisk UI, ikke data-avhengige tall. Sjekk om prosjektets
   guide (CLAUDE.md / README) sier noe om dette.

**Hovedregel:** Skriv tester som ser ut som de som allerede er der. Følg et prosjekts
eksisterende POM-oppsett, og ikke fjern POM i et prosjekt som bruker det.

**POM anbefales** for ikke-trivielle apper (flere sider/skjemaer/flows) — se
[PLAYWRIGHT_BEST_PRACTICES.md §9](PLAYWRIGHT_BEST_PRACTICES.md#9-page-object-model-pom). For
en helt liten enkelt-side-app med få interaksjoner kan rene spec-filer være klarere; ikke
innfør POM midt i en eksisterende plain-spec-suite uten å avklare det med eieren.

## Arbeidsflyt

1. **Detekter** (Steg 0).
2. **Avgjør hva som skal testes.** Utvid eksisterende spec-filer fremfor å improvisere
   engangs-browserskript. Test brukerens intensjon, ikke implementasjonsdetaljer.
3. **Skriv** etter prosjektets stil + de universelle prinsippene under.
4. **Kjør** prosjektets e2e-kommando og verifiser at alt er grønt. Ved data-avhengig
   ad-hoc-verifisering: bruk en temp dev-server på en ledig port, aldri den faste porten.
5. **Stopp og be om bekreftelse** før commit.

## Kommandoer (juster til prosjektet)

```bash
pnpm test:e2e                        # eller: npm run test:e2e / npx playwright test
npx playwright test <filnavn>        # spesifikk fil
npx playwright test --list           # list tester (verifiser at config laster)
npx playwright codegen <url>         # generer/finn robuste locators
```

## Universelle prinsipper

Disse gjelder i ALLE prosjekter. Detaljer og eksempler i
[PLAYWRIGHT_BEST_PRACTICES.md](PLAYWRIGHT_BEST_PRACTICES.md).

- **Rolle-baserte locators:** `getByRole` > `getByTestId` > `getByText`/`getByLabel` >
  CSS/XPath (sistnevnte er brittle — unngå).
- **Auto-waiting:** web-first assertions (`await expect(...).toBeVisible()`) venter selv.
  **ALDRI** `waitForTimeout(...)` — gir flaky tester.
- **Test-isolasjon:** hver test uavhengig; sett opp clean state i `beforeEach`.
- **Mock eksterne avhengigheter:** `page.route(...)` for stabile, forutsigbare tester —
  spesielt viktig for offline-safe og data-uavhengige assertions.
- **Soft assertions:** `expect.soft(...)` når du sjekker flere ting og vil se alle feil.
- **`expect()`, ikke `throw new Error()`** — gir retry, DOM-snapshot og trace-integrasjon.
- **Beskrivende feilmeldinger** i `expect(locator, "...")` for lettere debugging.

## Når lese hva

- **Skal skrive/endre tester?** Følg Steg 0 + Arbeidsflyt over, les PLAYWRIGHT_BEST_PRACTICES.md.
- **Skal bruke/lage POM?** Les PLAYWRIGHT_BEST_PRACTICES.md §9 (struktur, arkitekturregler,
  navnekonvensjoner).
- **Enhetstester (Vitest/Jest)?** Feil skill — dette er kun E2E.
