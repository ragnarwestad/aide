---
name: architecture-advisor
description: >-
  Arkitektur-vurderinger og refaktoreringsbeslutninger.
  Use when: vurderer arkitektur-endringer, skal refaktorere større kodedeler, skal introdusere nye design patterns.
  Do NOT use for: enkle bug fixes, små kodeendringer i én fil, ren implementering uten arkitekturbeslutninger
effort: xhigh
---

# Architecture Advisor

## Når å bruke denne skill

- Du vurderer arkitektur-endringer
- Du skal refaktorere større kodedeler
- Du skal introdusere nye design patterns
- Du skal evaluere code smells

---

## Layered Architecture

**Standard lag i både frontend og backend:**

```text
Presentation Layer (UI/API)
    ↓
Business Logic Layer (Services)
    ↓
Data Access Layer (Repositories)
    ↓
Database/External APIs
```

**Prinsipper:**
- ✅ Klar separasjon av ansvar
- ✅ Hver lag kommuniserer kun med laget under
- ✅ Business logic i eget lag (IKKE i controllers eller repositories)

---

## Design Patterns

### Repository Pattern (Data Access)

```kotlin
interface UserRepository {
    fun findById(id: Long): User?
    fun save(user: User): User
}
```

### Service Pattern (Business Logic)

```kotlin
class UserService(private val repository: UserRepository) {
    fun updateUser(id: Long, data: UserData): User {
        val user = repository.findById(id) ?: throw NotFoundException()
        return repository.save(user.copy(name = data.name))
    }
}
```

### Factory Pattern (Objektoppretting)

```typescript
class ComponentFactory {
  static create(type: string): Component {
    switch (type) {
      case 'button': return new ButtonComponent();
      case 'input': return new InputComponent();
      default: throw new Error('Unknown type');
    }
  }
}
```

### Strategy Pattern (Valgbare algoritmer)

```typescript
interface ValidationStrategy {
  validate(value: string): boolean;
}

class EmailValidator implements ValidationStrategy {
  validate(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
}
```

---

## Refactoring Strategies

### 1. Start med tester (sikkerhetsnett)

```bash
# ALLTID før refaktorering:
pnpm test -- --run
# Verifiser at alle tester passerer
```

### 2. Små, inkrementelle endringer

- ❌ Ikke refaktorer hele filen på en gang
- ✅ Refaktorer én funksjon/klasse av gangen
- ✅ Kjør tester etter hver endring

### 3. Verifiser etter hvert steg

```bash
# Etter hver refaktorering:
pnpm test -- --run           # Tester
npx tsc --noEmit             # TypeScript
pnpm run eslint              # Linting
```

### 4. Aldri endre oppførsel under refaktorering

- Refaktorering = samme output, bedre kode
- Ny funksjonalitet = separat commit

---

## Code Smells å unngå

### God Functions (> 50 linjer)

**Problem:**
```typescript
function processUser(user: User) {
  // 200 linjer kode...
}
```

**Løsning:**
```typescript
function processUser(user: User) {
  validateUser(user);
  enrichUserData(user);
  saveUser(user);
  sendNotification(user);
}
```

### Duplisert kode

**Problem:**
```typescript
// UserProfile.tsx
const fullName = user.firstName + ' ' + user.lastName;
```

```typescript
// UserCard.tsx
const fullName = user.firstName + ' ' + user.lastName;
```

**Løsning:**
```typescript
// I utils/userUtils.ts
export const getFullName = (user: User) =>
  `${user.firstName} ${user.lastName}`;
```

### For mange avhengigheter

**Problem:**
```kotlin
class UserService(
  private val repo1: Repo1,
  private val repo2: Repo2,
  private val repo3: Repo3,
  private val service1: Service1,
  private val service2: Service2,
  // ... 10 flere
)
```

**Løsning:**
- Split i mindre services
- Bruk facade pattern
- Vurder om all logikk hører hjemme her

### Mangel på abstraksjon

**Problem:**
```typescript
if (user.role === 'admin' || user.role === 'superadmin') {
  // ... 50 steder i koden
}
```

**Løsning:**
```typescript
const isAdmin = (user: User) =>
  ['admin', 'superadmin'].includes(user.role);

if (isAdmin(user)) {
  // ...
}
```

---

## Referanser

- Backend patterns
- Frontend kodestandard
