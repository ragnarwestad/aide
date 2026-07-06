---
name: tdd-coach
description: >-
  Test-Driven Development metodikk.
  Use when: skal implementere ny funksjonalitet, skal refaktorere eksisterende kode, skal sikre høy testdekning.
  Do NOT use for: oppgaveanalyse og planlegging (bruk task-workflow-assistant), kodebase-utforskning uten implementering
effort: high
---

# Tdd Coach

## Når å bruke denne skill

- Du skal implementere ny funksjonalitet
- Du skal refaktorere eksisterende kode
- Du skal sikre høy testdekning
- Du skal følge TDD-syklusen

---

## Grunnregler (gjelder ALLE faser)

1. Skriv minst mulig kode som tilfredsstiller krav og får testene til å passere
2. Foretrekk enkle løsninger fremfor smarte — tre like linjer er bedre enn en prematur abstraksjon
3. Ikke legg til feilhåndtering, validering eller abstraksjoner for scenarioer som ikke dekkes av krav eller tester
4. Ikke legg til docstrings, kommentarer eller type annotations utover det oppgaven krever
5. Behandle kravene som maksimalt scope og testene som akseptansekriterier — oppfyll begge, stopp
6. Ikke rør kode som ikke er relatert til oppgaven — ingen drive-by refactors eller tilfeldige oppryddinger
7. Følg eksisterende mønstre i kodebasen — ingen nye konvensjoner

---

## TDD-syklusen

### 1. RED PHASE

**Skriv tester først (basert på krav)**

```bash
# Steg 1: Les eksisterende tester for å forstå mønstre og fixtures
# Steg 2: Skriv tester som verifiserer kravene
# Steg 3: Kjør tester
pnpm test -- --run <testfil>
# Steg 4: Verifiser at tester FEILER på assertions (ikke på importfeil)
# Steg 5: Stopp og be om bekreftelse
```

**Regler for RED:**

- Skriv minimale, fokuserte tester med én assertion per test der det er praktisk
- Bruk eksisterende testmønstre og fixtures fra prosjektet
- Ikke skriv implementasjonskode
- Ikke skriv hjelpefunksjoner eller testabstraksjoner utover det som trengs
- Mock manglende moduler om nødvendig slik at tester feiler på assertions, ikke importfeil

### 2. GREEN PHASE

**Implementer minimalt for å få testene til å passere**

```bash
# Steg 1: Les testene for å forstå forventet oppførsel
# Steg 2: Implementer minste mulige kode
# Steg 3: Kjør tester etter hvert steg
pnpm test -- --run <testfil>
# Steg 4: Verifiser at alle tester PASSERER
# Steg 5: Stopp og be om bekreftelse
```

**Regler for GREEN:**

- Skriv kun koden som trengs for å passere testene
- Ikke legg til features, feilhåndtering eller abstraksjoner som ikke testes
- Ikke refaktorer eksisterende kode med mindre en test krever det
- Skriv enkel, direkte kode uten smarte triks

### 3. KVALITETSPORT

**Automatiserte sjekker som MÅ passere før REFACTOR**

```bash
# Frontend
pnpm test -- --run          # Alle tester passerer
npx tsc --noEmit            # TypeScript-sjekk
pnpm run eslint             # Linting

# Backend
./gradlew test              # Alle tester passerer
./gradlew ktlintCheck       # Kotlin linting
```

Alle sjekker må passere. Hvis noe feiler, fiks det i GREEN-fasen før du går videre.

### 4. REFACTOR PHASE

**Forbedre koden (uten å endre oppførsel)**

```bash
# Steg 1: Refaktorer kode
# Steg 2: Kjør alle tester og kvalitetssjekker på nytt
# Steg 3: Verifiser at alt fortsatt passerer
```

**Regler for REFACTOR:**

- Fjern duplisering og forbedre lesbarhet
- Ikke legg til features eller feilhåndtering som ikke dekkes av tester
- Ikke refaktorer for hypotetiske fremtidige behov
- Ikke legg til dokumentasjon, kommentarer eller type hints utover det som trengs
- Ikke foreslå ytelsesoptimaliseringer uten bevis på problem
- Ikke foreslå "nice to have"-forbedringer

---

## Testing-standarder

### Frontend (React/TypeScript)

- ✅ **Vitest** + **React Testing Library**
- ✅ `describe` + `it` struktur
- ✅ Mock eksterne avhengigheter
- ✅ Test happy path, edge cases, errors
- ✅ Målsetning: 80% coverage

### Backend (Kotlin/Spring Boot)

- ✅ **JUnit 5** + **MockK**
- ✅ `@Test` annotations
- ✅ Mock eksterne dependencies
- ✅ Test domain logic, repository, controller
- ✅ Målsetning: 80% coverage

### E2E Tests

- ✅ **Playwright** for frontend E2E
- ✅ Test kritiske brukerflyter
- ✅ Kjør før deployment

---

## Best practices

### 1. Test Edge Cases

```typescript
describe('validateEmail', () => {
  it('should accept valid email', () => {
    expect(validateEmail('test@example.com')).toBe(true);
  });

  it('should reject email without @', () => {
    expect(validateEmail('testexamplecom')).toBe(false);
  });

  it('should handle null gracefully', () => {
    expect(validateEmail(null)).toBe(false);
  });

  it('should handle empty string', () => {
    expect(validateEmail('')).toBe(false);
  });
});
```

### 2. Mock External Dependencies

```typescript
import { vi } from 'vitest';
import { apiClient } from './api';

vi.mock('./api', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

it('should fetch user data', async () => {
  apiClient.get.mockResolvedValue({ name: 'Test User' });
  const user = await fetchUser(123);
  expect(user.name).toBe('Test User');
});
```

### 3. Test Error Cases

```typescript
it('should handle API errors', async () => {
  apiClient.get.mockRejectedValue(new Error('Network error'));
  await expect(fetchUser(123)).rejects.toThrow('Network error');
});
```

---

## Referanser

- `testing-reglene` - Fullstendig testing-regelverk
- `workflows-reglene` - TDD-workflow i kontekst av JIRA/TODO
- Frontend kodestandard
