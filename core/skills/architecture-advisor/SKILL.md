---
name: architecture-advisor
description: >-
  Architecture assessments and refactoring decisions.
  Use when: evaluating architecture changes, refactoring larger parts of the codebase, introducing new design patterns.
  Do NOT use for: simple bug fixes, small code changes in a single file, pure implementation without architecture decisions
effort: xhigh
---

# Architecture Advisor

## When to use this skill

- You are evaluating architecture changes
- You are refactoring larger parts of the codebase
- You are introducing new design patterns
- You are evaluating code smells

---

## Layered Architecture

**Standard layers in both frontend and backend:**

```text
Presentation Layer (UI/API)
    ↓
Business Logic Layer (Services)
    ↓
Data Access Layer (Repositories)
    ↓
Database/External APIs
```

**Principles:**
- ✅ Clear separation of concerns
- ✅ Each layer communicates only with the layer below
- ✅ Business logic in its own layer (NOT in controllers or repositories)

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

### Factory Pattern (Object creation)

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

### Strategy Pattern (Interchangeable algorithms)

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

### 1. Start with tests (safety net)

```bash
# ALWAYS before refactoring:
pnpm test -- --run
# Verify that all tests pass
```

### 2. Small, incremental changes

- ❌ Do not refactor the entire file at once
- ✅ Refactor one function/class at a time
- ✅ Run tests after every change

### 3. Verify after each step

```bash
# After each refactoring:
pnpm test -- --run           # Tests
npx tsc --noEmit             # TypeScript
pnpm run eslint              # Linting
```

### 4. Never change behavior during refactoring

- Refactoring = same output, better code
- New functionality = separate commit

---

## Code Smells to avoid

### God Functions (> 50 lines)

**Problem:**
```typescript
function processUser(user: User) {
  // 200 lines of code...
}
```

**Solution:**
```typescript
function processUser(user: User) {
  validateUser(user);
  enrichUserData(user);
  saveUser(user);
  sendNotification(user);
}
```

### Duplicated code

**Problem:**
```typescript
// UserProfile.tsx
const fullName = user.firstName + ' ' + user.lastName;
```

```typescript
// UserCard.tsx
const fullName = user.firstName + ' ' + user.lastName;
```

**Solution:**
```typescript
// In utils/userUtils.ts
export const getFullName = (user: User) =>
  `${user.firstName} ${user.lastName}`;
```

### Too many dependencies

**Problem:**
```kotlin
class UserService(
  private val repo1: Repo1,
  private val repo2: Repo2,
  private val repo3: Repo3,
  private val service1: Service1,
  private val service2: Service2,
  // ... 10 more
)
```

**Solution:**
- Split into smaller services
- Use the facade pattern
- Consider whether all the logic belongs here

### Lack of abstraction

**Problem:**
```typescript
if (user.role === 'admin' || user.role === 'superadmin') {
  // ... 50 places in the code
}
```

**Solution:**
```typescript
const isAdmin = (user: User) =>
  ['admin', 'superadmin'].includes(user.role);

if (isAdmin(user)) {
  // ...
}
```

---

## References

- Backend patterns
- Frontend coding standard
