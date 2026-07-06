# Testing rules for AI-assisted development

## Table of contents

- [Core rule](#core-rule)
- [Test commands](#test-commands)
  - [Unit tests (Vitest)](#unit-tests-vitest)
  - [E2E tests (Playwright)](#e2e-tests-playwright)
- [Workflow](#workflow)
  - [Example of a correct workflow](#example-of-a-correct-workflow)
  - [When tests fail](#when-tests-fail)
- [TDD approach](#tdd-approach-test-driven-development)
- [Watch mode warnings](#watch-mode-warnings)

---

## Core rule

**ALWAYS run tests when you create or modify them!**

### ❌ NEVER
- Create tests without running them
- Modify tests without verifying that they still work
- Assume that tests pass without checking
- Commit failing tests

### ✅ CORRECT approach
1. When you create/modify tests, **run them immediately**
2. **Verify** that all tests pass (green ✅)
3. If tests fail (red ❌):
   - Analyze the error message
   - Fix the problem (either the test or the code)
   - Re-run until everything passes
4. **Before committing:** Run the entire test suite to check for regressions

---

## Test commands

### Unit tests (Vitest)
```bash
# All tests (ALWAYS use --run to avoid watch mode!)
pnpm test -- --run

# Specific test file
pnpm test -- --run <filename>

# With coverage report
pnpm run test:coverage
```

### E2E tests (Playwright)
```bash
# All e2e tests
pnpm run test:e2e

# Specific e2e test
pnpm exec playwright test <filename>

# With UI mode (AVOID - keeps the process open)
pnpm run test:e2e:ui
```

---

## Workflow

### Example of a correct workflow
```text
1. Created test: src/utils/country.test.ts
2. Run: pnpm test -- --run country.test.ts
3. ✅ All 5 tests pass
4. Run: pnpm test -- --run (full suite for regression check)
5. ✅ 1247 tests pass, 0 fail
6. Now it is safe to commit
```

### When tests fail
```text
1. Created test: src/components/UserForm.test.tsx
2. Run: pnpm test -- --run UserForm.test.tsx
3. ❌ 2 of 8 tests fail
4. Analyze the error message: "Expected <button> to be disabled, but was enabled"
5. Fix the code in UserForm.tsx (disabled logic)
6. Run: pnpm test -- --run UserForm.test.tsx
7. ✅ All 8 tests pass
8. Run: pnpm test -- --run (full suite)
9. ✅ 1255 tests pass, 0 fail
10. Now it is safe to commit
```

---

## TDD approach (Test-Driven Development)

**Red → Green → Refactor**

### 1. RED: Write a failing test
Prove the problem by writing a test that demonstrates the desired behavior (but fails because the code is not implemented yet).

```tsx
// Example: Test for new functionality that does not exist yet
test('getCountryName should return "Norway" for code "NO"', () => {
  expect(getCountryName('NO')).toBe('Norway');
});

// Run: pnpm test -- --run country.test.ts
// ❌ Fails (proves that the functionality is missing)
```

### 2. GREEN: Implement until the test passes
Write minimal code to make the test pass.

```typescript
// Implement the functionality
export function getCountryName(code: string): string {
  const countries = {
    'NO': 'Norway',
    'SE': 'Sweden',
    'DK': 'Denmark',
  };
  return countries[code] || 'Unknown';
}

// Run: pnpm test -- --run country.test.ts
// ✅ Passes (the functionality works)
```

### 3. REFACTOR: Run all tests
Verify that no existing functionality was broken.

```bash
# Run the entire test suite
pnpm test -- --run

# ✅ All 1255 tests pass (no regressions)
```

---

## Watch mode warnings

### CRITICAL: All tests MUST terminate after running

**IMPORTANT:** Tests must always be run so that the process exits when the tests are done.

```bash
# ✅ CORRECT - Tests run and the process exits
pnpm test -- --run                    # Vitest - exits after running
pnpm test -- --run UserProfile.test.tsx  # Specific test
pnpm run test:e2e                     # Playwright - exits automatically

# ❌ WRONG - Watch mode (the process NEVER exits)
pnpm test                             # Starts in watch mode
pnpm test UserProfile.test.tsx        # Watch mode
pnpm run test:e2e:ui                  # Playwright UI mode
```

### Why this is critical

**In AI-assisted development:**
- AI cannot interact with watch mode (requires manual input to exit)
- Processes stay open in the background and must be killed manually
- Impossible for AI to verify when tests have finished running
- Can cause resource leaks

**In CI/CD pipelines:**
- Watch mode blocks the pipeline (waits forever)
- Consumes resources unnecessarily
- Makes automated workflows impossible

**In the TDD workflow:**
- You must be able to run tests multiple times in the cycle
- Each run must exit to move on to the next phase
- Watch mode breaks the automation

### How to check whether test processes are hanging

**WARNING:** Only kill processes you started yourself, not all node processes!

```bash
# Check whether YOUR test processes are hanging (do not kill automatically!)
ps aux | grep vitest
ps aux | grep playwright

# See PID and command to identify your processes
ps aux | grep "[v]itest"    # Shows vitest processes
ps aux | grep "[p]laywright" # Shows playwright processes

# Kill ONLY processes you started yourself (use the PID from the output above)
kill <PID>                   # Replace <PID> with the process ID

# Example:
# ps aux | grep vitest
# > ragnar  12345  ... node .../vitest/...
# kill 12345
```

**IMPORTANT:**
- ❌ **NEVER** use `pkill -f node` (kills all node processes!)
- ❌ **NEVER** use `pkill -f vitest` without checking first
- ✅ Use `ps aux` to identify your processes
- ✅ Use `kill <PID>` to kill specific processes

---

## Summary

**Three golden rules:**
1. ✅ Run tests **immediately** after creating/modifying them
2. ✅ Verify that **all tests pass** before committing
3. ✅ Use **TDD** (Red → Green → Refactor) for new features

**This rule ALWAYS applies - testing is not optional!**
