# Testing-regler for AI-assistert utvikling

## Innholdsfortegnelse

- [Hovednorm](#hovednorm)
- [Testkommandoer](#testkommandoer)
  - [Enhetstester (Vitest)](#enhetstester-vitest)
  - [E2E-tester (Playwright)](#e2e-tester-playwright)
- [Arbeidsflyt](#arbeidsflyt)
  - [Eksempel på riktig arbeidsflyt](#eksempel-på-riktig-arbeidsflyt)
  - [Ved feilende tester](#ved-feilende-tester)
- [TDD-tilnærming](#tdd-tilnærming-test-driven-development)
- [Watch mode advarsler](#watch-mode-advarsler)

---

## Hovednorm

**ALLTID kjør tester når du oppretter eller endrer dem!**

### ❌ ALDRI
- Opprett tester uten å kjøre dem
- Endre tester uten å verifisere at de fortsatt fungerer
- Anta at tester passerer uten å sjekke
- Committe tester som feiler

### ✅ RIKTIG fremgangsmåte
1. Når du oppretter/endrer tester, **kjør dem umiddelbart**
2. **Verifiser** at alle tester passerer (grønne ✅)
3. Hvis tester feiler (røde ❌):
   - Analyser feilmeldingen
   - Fiks problemet (enten testen eller koden)
   - Kjør på nytt til alle passerer
4. **Før commit:** Kjør hele testsuiten for å sjekke for regresjoner

---

## Testkommandoer

### Enhetstester (Vitest)
```bash
# Alle tester (ALLTID bruk --run for å unngå watch mode!)
pnpm test -- --run

# Spesifikk testfil
pnpm test -- --run <filnavn>

# Med dekningsrapport
pnpm run test:coverage
```

### E2E-tester (Playwright)
```bash
# Alle e2e-tester
pnpm run test:e2e

# Spesifikk e2e-test
pnpm exec playwright test <filnavn>

# Med UI-modus (UNNGÅ - holder prosess åpen)
pnpm run test:e2e:ui
```

---

## Arbeidsflyt

### Eksempel på riktig arbeidsflyt
```text
1. Opprettet test: src/utils/land.test.ts
2. Kjører: pnpm test -- --run land.test.ts
3. ✅ Alle 5 tester passerer
4. Kjører: pnpm test -- --run (full suite for regresjonssjekk)
5. ✅ 1247 tester passerer, 0 feiler
6. Nå er det trygt å committe
```

### Ved feilende tester
```text
1. Opprettet test: src/components/UserForm.test.tsx
2. Kjører: pnpm test -- --run UserForm.test.tsx
3. ❌ 2 av 8 tester feiler
4. Analyserer feilmelding: "Expected <button> to be disabled, but was enabled"
5. Fikser koden i UserForm.tsx (disabled-logikk)
6. Kjører: pnpm test -- --run UserForm.test.tsx
7. ✅ Alle 8 tester passerer
8. Kjører: pnpm test -- --run (full suite)
9. ✅ 1255 tester passerer, 0 feiler
10. Nå er det trygt å committe
```

---

## TDD-tilnærming (Test-Driven Development)

**Red → Green → Refactor**

### 1. RED: Skriv test som feiler
Bevis problemet ved å skrive en test som demonstrerer ønsket oppførsel (men feiler fordi koden ikke er implementert ennå).

```tsx
// Eksempel: Test for ny funksjonalitet som ikke finnes ennå
test('getLandnavn should return "Norge" for code "NO"', () => {
  expect(getLandnavn('NO')).toBe('Norge');
});

// Kjør: pnpm test -- --run land.test.ts
// ❌ Feiler (beviser at funksjonaliteten mangler)
```

### 2. GREEN: Implementer til testen passerer
Skriv minimal kode for å få testen til å passere.

```typescript
// Implementer funksjonaliteten
export function getLandnavn(code: string): string {
  const land = {
    'NO': 'Norge',
    'SE': 'Sverige',
    'DK': 'Danmark',
  };
  return land[code] || 'Ukjent';
}

// Kjør: pnpm test -- --run land.test.ts
// ✅ Passerer (funksjonaliteten virker)
```

### 3. REFACTOR: Kjør alle tester
Verifiser at ingen eksisterende funksjonalitet ble ødelagt.

```bash
# Kjør hele testsuiten
pnpm test -- --run

# ✅ Alle 1255 tester passerer (ingen regresjoner)
```

---

## Watch mode advarsler

### KRITISK: Alle tester MÅ avsluttes etter kjøring

**VIKTIG:** Tester må alltid kjøres slik at prosessen avsluttes når testene er ferdige.

```bash
# ✅ RIKTIG - Tester kjører og prosessen avsluttes
pnpm test -- --run                    # Vitest - avslutter etter kjøring
pnpm test -- --run UserProfile.test.tsx  # Spesifikk test
pnpm run test:e2e                     # Playwright - avslutter automatisk

# ❌ FEIL - Watch mode (prosessen avsluttes ALDRI)
pnpm test                             # Starter i watch mode
pnpm test UserProfile.test.tsx        # Watch mode
pnpm run test:e2e:ui                  # Playwright UI-modus
```

### Hvorfor dette er kritisk

**I AI-assistert utvikling:**
- AI kan ikke interagere med watch mode (krever manuell input for å avslutte)
- Prosesser holder åpne i bakgrunnen og må drepen manuelt
- Umulig for AI å verifisere når tester er ferdig kjørt
- Kan forårsake resource-leaks

**I CI/CD pipelines:**
- Watch mode blokkerer pipeline (venter i det uendelige)
- Spiser ressurser unødvendig
- Gjør automatiserte workflows umulige

**I TDD-workflow:**
- Du må kunne kjøre tester flere ganger i syklusen
- Hver kjøring må avslutte for å gå videre til neste fase
- Watch mode ødelegger automatiseringen

### Hvordan sjekke om test-prosesser henger

**ADVARSEL:** Drep kun prosesser du selv har startet, ikke alle node-prosesser!

```bash
# Sjekk om DINE test-prosesser henger (ikke drep automatisk!)
ps aux | grep vitest
ps aux | grep playwright

# Se PID og kommando for å identifisere dine prosesser
ps aux | grep "[v]itest"    # Viser vitest-prosesser
ps aux | grep "[p]laywright" # Viser playwright-prosesser

# Drep KUN prosesser du selv har startet (bruk PID fra output over)
kill <PID>                   # Erstatt <PID> med prosess-ID

# Eksempel:
# ps aux | grep vitest
# > ragnar  12345  ... node .../vitest/...
# kill 12345
```

**VIKTIG:**
- ❌ **ALDRI** bruk `pkill -f node` (dreper alle node-prosesser!)
- ❌ **ALDRI** bruk `pkill -f vitest` uten å sjekke først
- ✅ Bruk `ps aux` for å identifisere dine prosesser
- ✅ Bruk `kill <PID>` for å drepe spesifikke prosesser

---

## Oppsummering

**Tre gullregler:**
1. ✅ Kjør tester **umiddelbart** etter opprettelse/endring
2. ✅ Verifiser at **alle tester passerer** før commit
3. ✅ Bruk **TDD** (Red → Green → Refactor) for nye features

**Denne regelen gjelder ALLTID - testing er ikke valgfritt!**
