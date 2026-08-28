# Playwright best practices (prosjekt-uavhengig)

Universelle Playwright-prinsipper som gjelder uansett prosjekt. For oppsett, deteksjon av
prosjektkonvensjoner og arbeidsflyt, se [SKILL.md](SKILL.md).

## Innhold

- [1. Locator-strategi](#1-locator-strategi)
- [2. Auto-waiting vs manuell waiting](#2-auto-waiting-vs-manuell-waiting)
- [3. Test-isolasjon](#3-test-isolasjon)
- [4. Mock eksterne avhengigheter](#4-mock-eksterne-avhengigheter)
- [5. Soft assertions](#5-soft-assertions)
- [6. Bruk expect() — ikke throw Error](#6-bruk-expect--ikke-throw-error)
- [7. Beskrivende feilmeldinger](#7-beskrivende-feilmeldinger)
- [8. Debugging-config](#8-debugging-config)
- [9. Page Object Model (POM)](#9-page-object-model-pom)
  - [9.1 Når bruke POM](#91-når-bruke-pom)
  - [9.2 Struktur](#92-struktur)
  - [9.3 Arkitekturregler](#93-arkitekturregler)
  - [9.4 Navnekonvensjoner](#94-navnekonvensjoner)
  - [9.5 Verifikasjoner i POM](#95-verifikasjoner-i-pom)
  - [9.6 Implementeringstips](#96-implementeringstips)
- [10. Ressurser](#10-ressurser)

---

## 1. Locator-strategi

Prioriter robuste, intensjons-baserte locators:

```tsx
// ✅ BESTE — Role-based (mest robust mot DOM-endringer)
page.getByRole("button", { name: "Lagre" });
page.getByRole("textbox", { name: "Søk" });
page.getByRole("combobox", { name: "Språk" });

// ✅ BRA — Test ID (stabil, krever data-testid i markup)
page.getByTestId("save-button");

// ⚠️ OK — Text/Label (kan være brittle ved språk-/tekstendringer)
page.getByText("Lagre");
page.getByLabel("Søk");

// ❌ UNNGÅ — CSS/XPath (veldig brittle ved design-endringer)
page.locator(".btn--green.btn--large");
page.locator("div > button:nth-child(2)");
```

Bruk codegen for å finne robuste locators: `npx playwright codegen <url>`.

## 2. Auto-waiting vs manuell waiting

Playwright venter automatisk — utnytt det.

```tsx
// ✅ RIKTIG — web-first assertions venter automatisk (opptil timeout)
await expect(page.getByText("Lagret")).toBeVisible();

// ❌ FEIL — manuell assertion venter IKKE
expect(await page.getByText("Lagret").isVisible()).toBe(true);

// ❌ ALDRI hardkodede waits (flaky tests!)
await page.waitForTimeout(3000);
```

Trenger du å vente på en tilstand, vent på noe observerbart (`toBeVisible`,
`toHaveURL`, en `page.waitForResponse(...)`), ikke på klokka.

## 3. Test-isolasjon

Hver test MÅ være uavhengig av rekkefølge og av andre tester.

```tsx
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // Sett opp clean state her
});

test("test 1", async ({ page }) => {
  // Skal IKKE påvirke test 2
});
```

## 4. Mock eksterne avhengigheter

Ikke la testene avhenge av eksterne systemer eller live-data — det gir flaky tester og
hindrer offline-kjøring.

```tsx
test("viser korrekt status", async ({ page }) => {
  await page.route("**/api/status/*", (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ status: "OK" }) }),
  );
  await page.goto("/");
  await expect(page.getByText("OK")).toBeVisible();
});
```

For apper som henter data fra CDN/nett: enten mock kallene, eller hold testene
**offline-safe** ved å asserte på statisk UI (modaler, toggles, struktur) i stedet for
data-avhengige tall.

## 5. Soft assertions

Sjekk flere ting uten å stoppe ved første feil — rapporten viser alle.

```tsx
await expect.soft(page.getByText("Tittel")).toBeVisible();
await expect.soft(page.getByText("Status: OK")).toBeVisible();
await expect.soft(page.getByRole("button", { name: "Neste" })).toBeEnabled();
```

## 6. Bruk expect() — ikke throw Error

Bruk alltid Playwright sine `expect`-assertions fremfor `throw new Error()`.

```tsx
// ✅ RIKTIG
await expect(page.getByTestId("saldo")).toHaveText("100");
await expect(page.getByRole("button", { name: "Lagre" })).toBeVisible();

// ❌ FEIL
const saldo = await page.getByTestId("saldo").textContent();
if (saldo !== "100") throw new Error(`Forventet 100, fikk ${saldo}`);
```

**Hvorfor:** automatisk venting/retry, bedre feilmeldinger med DOM-snapshot, automatiske
screenshots ved feil, og integrasjon med trace viewer.

## 7. Beskrivende feilmeldinger

Legg en melding i `expect(...)` så feilen forteller hva som var galt.

```tsx
// ✅ Riktig
await expect(
  page.getByRole("button", { name: "Bekreft" }),
  "Bekreft-knappen skal være aktivert etter at alle felt er fylt ut",
).toBeEnabled({ timeout: 5000 });

// ❌ Feil — ingen kontekst ved feil
await expect(page.getByRole("button", { name: "Bekreft" })).toBeEnabled();
```

## 8. Debugging-config

I `playwright.config.*` — samle artefakter kun ved behov, ikke alltid:

```tsx
export default defineConfig({
  use: {
    trace: "on-first-retry", // trace kun ved retry
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
```

Bruk aldri html-reporteren i CI/agent-kontekst uten å være klar over at den starter en
server som ikke avslutter av seg selv (`reporter: "list"` er trygt).

## 9. Page Object Model (POM)

POM er det **anbefalte** mønsteret for ikke-trivielle apper: hver side/komponent får en
klasse som samler dens locators og handlinger, så testene leser som brukerhandlinger og en
DOM-endring fikses ett sted. Specs blir lesbare, locators gjenbrukes, vedlikehold blir billig.

### 9.1 Når bruke POM

- **Bruk POM** for apper med flere sider/skjermer, skjemaer, flows eller gjenbrukt
  interaksjon. Standardvalget for noe som vokser.
- **Bruker prosjektet allerede POM** (egen `pages/`-mappe)? Følg dets konvensjoner uansett
  hva som står her — navngivning, parametre, returtyper.
- **Unntak — hopp over POM** for en liten enkelt-side-app med få, enkle interaksjoner: der
  er rene spec-filer med `getByRole(...)` direkte ofte klarere. Ikke innfør et POM-lag bare
  for prinsippets skyld.

### 9.2 Struktur

```text
e2e/
├── pages/                     # Page Object Models — én klasse per side/komponent
│   ├── home.page.ts
│   └── checkout/
│       └── checkout.page.ts
├── fixtures/                  # delte test-fixtures / hjelpere
└── specs/                     # test-specs (kan også ligge rett i e2e/)
```

En typisk POM-klasse:

```tsx
import { type Page, type Locator, expect } from "@playwright/test";

export class HomePage {
  constructor(private readonly page: Page) {}

  // Eksponer locators som getters/felt, ikke rå selektorer i testene
  private readonly searchBox = (): Locator =>
    this.page.getByRole("searchbox", { name: "Search" });

  async goto(): Promise<void> {
    await this.page.goto("/");
  }

  async search(term: string): Promise<void> {
    await this.searchBox().fill(term);
    await this.searchBox().press("Enter");
  }

  async expectResultCount(n: number): Promise<void> {
    await expect(this.page.getByRole("listitem")).toHaveCount(n);
  }
}
```

### 9.3 Arkitekturregler

- ✅ **All side-interaksjon går via POM-klasser** — testene uttrykker intensjon, ikke DOM.
- ✅ **Lag ny POM-fil** når en side mangler en.
- ❌ **Ingen lavnivå Playwright-API i specs:** ikke `page.locator()`, `page.click()`,
  `page.fill()` direkte i testen — innkapsle det i POM-en. (`page.goto`/`route` i
  fixtures/oppsett er greit.)
- ✅ **POM-metoder bruker `expect()`** for venting og verifisering — ikke `throw`.

### 9.4 Navnekonvensjoner

Metodenavn skal gjenspeile **brukerens intensjon og UI-elementet**, ikke teknisk
implementasjon. Bruk konsistente verb-prefikser. (Tabellen under bruker engelske verb som
en nøytral default — et prosjekt kan lokalisere prefiksene, men da konsekvent for HELE
suiten. Melosys bruker f.eks. norske `klikk/input/velg/verifiser` — se
`melosys-web-e2e-testing`.)

| UI-element / handling | Konvensjon | Eksempel |
|----------------------|------------|----------|
| Knapp | `click<Label>()` | `clickSave()` |
| Checkbox | `check<Label>()` / `toggle<Label>()` | `checkRemember()` |
| Tekstfelt | `fill<Label>(value: string)` | `fillEmail("a@b.no")` |
| Datofelt | `set<Label>(date: string)` | `setStartDate("01.01.2024")` |
| Select/Radio | `select<Label>(value)` | `selectCountry("NO")` |
| Navigasjon | `goto<Page>()` | `gotoCheckout()` |
| Lese data | `get<Data>(): Promise<T>` | `getOrderId()` |
| Vent på tilstand | `waitFor<State>()` | `waitForLoaded()` |
| Verifisering | `expect<What>()` | `expectErrorShown()` |
| Sammensatt flow | `<verb><What>()` | `completeCheckout(...)` |

Generelle regler: **camelCase**, **async/await**, **eksplisitt returtype**
(`Promise<void>` / `Promise<string>`), og **union types** for enum-aktige parametre
(`select("JA" | "NEI")`) fremfor `string`.

### 9.5 Verifikasjoner i POM

Verifikasjonsmetoder skal **kaste via `expect()`**, ikke returnere boolean:

```tsx
// ✅ Riktig — venter + gir DOM-snapshot ved feil
async expectSaveEnabled(): Promise<void> {
  await expect(
    this.page.getByRole("button", { name: "Save" }),
    "Save-knappen skal være aktivert når skjemaet er gyldig",
  ).toBeEnabled();
}

// ❌ Feil — returnerer boolean, ingen venting, taper kontekst
async isSaveEnabled(): Promise<boolean> {
  return this.page.getByRole("button", { name: "Save" }).isEnabled();
}
```

### 9.6 Implementeringstips

- Hold locators private i klassen; eksponer **handlinger og verifikasjoner**, ikke locators.
- Én klasse per side/komponent; del opp store sider i delkomponenter fremfor én gigaklasse.
- Legg beskrivende meldinger i `expect(...)` (se [§7](#7-beskrivende-feilmeldinger)).
- Ved migrering av eksisterende tester: ikke refaktorer alt på en gang — marker gamle
  metoder `@deprecated` med peker til den nye, og migrer gradvis.

## 10. Ressurser

- [Playwright Best Practices (offisiell dok.)](https://playwright.dev/docs/best-practices)
- [Playwright — Locators](https://playwright.dev/docs/locators)
- [Martin Fowler — PageObject](https://martinfowler.com/bliki/PageObject.html)
