---
name: tdd-coach
description: >-
  Test-Driven Development methodology.
  Use when: implementing new functionality, refactoring existing code, ensuring high test coverage.
  Do NOT use for: task analysis and planning (use task-workflow-assistant), codebase exploration without implementation
effort: high
---

# Tdd Coach

## When to use this skill

- You are implementing new functionality
- You are refactoring existing code
- You need to ensure high test coverage
- You are following the TDD cycle

---

## Ground rules (apply to ALL phases)

1. Write the least amount of code that satisfies the requirements and makes the tests pass
2. Prefer simple solutions over clever ones — three similar lines are better than a premature abstraction
3. Do not add error handling, validation, or abstractions for scenarios not covered by requirements or tests
4. Do not add docstrings, comments, or type annotations beyond what the task requires
5. Treat the requirements as the maximum scope and the tests as acceptance criteria — satisfy both, then stop
6. Do not touch code unrelated to the task — no drive-by refactors or incidental cleanups
7. Follow existing patterns in the codebase — no new conventions

---

## The TDD cycle

### 1. RED PHASE

**Write tests first (based on requirements)**

```bash
# Step 1: Read existing tests to understand patterns and fixtures
# Step 2: Write tests that verify the requirements
# Step 3: Run the tests
pnpm test -- --run <test-file>
# Step 4: Verify that tests FAIL on assertions (not on import errors)
# Step 5: Stop and ask for confirmation
```

**Rules for RED:**

- Write minimal, focused tests with one assertion per test where practical
- Use existing test patterns and fixtures from the project
- Do not write implementation code
- Do not write helper functions or test abstractions beyond what is needed
- Mock missing modules if necessary so tests fail on assertions, not import errors

### 2. GREEN PHASE

**Implement minimally to make the tests pass**

```bash
# Step 1: Read the tests to understand the expected behavior
# Step 2: Implement the least possible code
# Step 3: Run the tests after each step
pnpm test -- --run <test-file>
# Step 4: Verify that all tests PASS
# Step 5: Stop and ask for confirmation
```

**Rules for GREEN:**

- Write only the code needed to pass the tests
- Do not add features, error handling, or abstractions that are not tested
- Do not refactor existing code unless a test requires it
- Write simple, direct code without clever tricks

### 3. QUALITY GATE

**Automated checks that MUST pass before REFACTOR**

```bash
# Frontend
pnpm test -- --run          # All tests pass
npx tsc --noEmit            # TypeScript check
pnpm run eslint             # Linting

# Backend
./gradlew test              # All tests pass
./gradlew ktlintCheck       # Kotlin linting
```

All checks must pass. If anything fails, fix it in the GREEN phase before moving on.

### 4. REFACTOR PHASE

**Improve the code (without changing behavior)**

```bash
# Step 1: Refactor the code
# Step 2: Rerun all tests and quality checks
# Step 3: Verify that everything still passes
```

**Rules for REFACTOR:**

- Remove duplication and improve readability
- Do not add features or error handling not covered by tests
- Do not refactor for hypothetical future needs
- Do not add documentation, comments, or type hints beyond what is needed
- Do not suggest performance optimizations without evidence of a problem
- Do not suggest "nice to have" improvements

---

## Testing standards

### Frontend (React/TypeScript)

- ✅ **Vitest** + **React Testing Library**
- ✅ `describe` + `it` structure
- ✅ Mock external dependencies
- ✅ Test happy path, edge cases, errors
- ✅ Target: 80% coverage

### Backend (Kotlin/Spring Boot)

- ✅ **JUnit 5** + **MockK**
- ✅ `@Test` annotations
- ✅ Mock external dependencies
- ✅ Test domain logic, repository, controller
- ✅ Target: 80% coverage

### E2E Tests

- ✅ **Playwright** for frontend E2E
- ✅ Test critical user flows
- ✅ Run before deployment

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

## References

- `the testing rules` - Complete testing ruleset
- `the workflow rules` - The TDD workflow in the context of JIRA/TODO
- Frontend coding standard
