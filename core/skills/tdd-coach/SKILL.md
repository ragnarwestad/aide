---
name: tdd-coach
description: >-
  Test-Driven Development methodology.
  Use when: implementing new functionality, refactoring existing code, ensuring high test coverage.
  Do NOT use for: task analysis and planning (use task-workflow-assistant), codebase exploration without implementation
effort: high
---

# Tdd Coach

## Ground rules (apply to ALL phases)

1. Write the least amount of code that satisfies the requirements and makes the tests pass
2. Prefer simple solutions over clever ones — three similar lines are better than a premature abstraction
3. Do not add error handling, validation, or abstractions for scenarios not covered by requirements or tests
4. Do not add docstrings, comments, or type annotations beyond what the task requires
5. Treat the requirements as the maximum scope and the tests as acceptance criteria — satisfy both, then stop
6. Do not touch code unrelated to the task — no drive-by refactors or incidental cleanups
7. Follow existing patterns in the codebase — no new conventions

---

## One test at a time

Write one failing test, then the least code that makes it pass, then the
next test. RED and GREEN below are one turn of that loop; the quality
gate and REFACTOR come after the last test. Inside a spec's
/aide-implement run, the plan's Task 0 and implement's own steps set the
order of tests and code.

---

## Two kinds of test that are worth nothing

1. **The test that works out its expected value the way the code does.**
   It cannot disagree with the code, so it passes whether the code is
   right or not. Write the expected value as a literal, worked out from
   the requirement. The testing rule's revert check ("Prove the test is
   worth having") can catch one when the fix changes the formula.
2. **All the tests first, all the code after.** Tests written ahead of
   any code describe a design nobody has tried yet, and fail or pass
   together, so no single one says which behaviour is missing.

---

## The TDD cycle

The commands below are from a pnpm/Vitest project — substitute the project's
own commands (see "Project commands" in the tools-and-scripts rules).

### 1. RED PHASE

**Write the next test first (based on requirements)**

```bash
# Step 1: Read existing tests to understand patterns and fixtures
# Step 2: Write one test that verifies a requirement
# Step 3: Run the test
pnpm test -- --run <test-file>
# Step 4: Verify that it FAILS on an assertion (not on an import error)
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
# Then write the next test
```

**Rules for GREEN:**

- Write only the code needed to pass the tests
- Do not add features, error handling, or abstractions that are not tested
- Do not refactor existing code unless a test requires it
- Write simple, direct code without clever tricks

### 3. QUALITY GATE

**Automated checks that MUST pass before REFACTOR**

The project's own type check and lint, and its tests as its rules say
(inside a spec's /aide-implement run the whole suite is the runner's):

```bash
npx tsc --noEmit            # TypeScript check
pnpm run eslint             # Linting
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

Use the project's own test framework, structure and fixtures. What a
test is for, and what it is not, is the testing rule's "What to test".

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

- The testing rule — the complete testing ruleset
- The workflows skill — the TDD workflow in the context of a spec
