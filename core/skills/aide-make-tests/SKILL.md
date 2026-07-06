---
name: aide-make-tests
description: >-
  Analyze a file and create missing unit tests.
  Use when: generating missing tests for a specific file, increasing test coverage.
  Do NOT use for: TDD implementation (use aide-implement), code review
disable-model-invocation: true
argument-hint: "[file-path]"
effort: high
---

Analyze a file and create missing unit tests.

**Input:** $ARGUMENTS (file path to analyze)

## Argument parsing

Parse `$ARGUMENTS`:

**File-path mode:**
- Example: `/aide-make-tests src/utils/country.ts`
- Analyze the file and create missing tests

**Error handling:** If the argument is missing or has an invalid format, show:

```text
Missing file path

Usage:
/aide-make-tests <file-path>

Examples:
/aide-make-tests src/utils/country.ts
/aide-make-tests src/components/UserProfile.tsx
/aide-make-tests src/api/userService.ts
```

---

# Prompt: Create missing unit tests

**Purpose:** Analyze a file and create comprehensive unit tests (equivalent to `/aide-make-tests` in Claude Code)

---

---

## Prompt

```text
Analyze the file <file-path> and create missing unit tests:

STEP 1: ANALYZE THE FILE
- Read the file: <file-path>
- Identify all exported functions
- Check the existing test file (e.g. <file-path>.test.ts)
- Identify gaps in the test coverage

STEP 2: WRITE COMPREHENSIVE TESTS
For each function that lacks tests:
- Happy path (normal scenarios)
- Edge cases (boundary conditions)
- Error cases (error handling)

STEP 3: RUN TESTS AND VERIFY
- Run: pnpm test -- --run <test file>
- Verify that all new tests pass
- Fix any failures

STEP 4: GENERATE A COVERAGE REPORT
- Run: pnpm test -- --coverage <file-path>
- Show before/after test coverage
- Summarize the number of tests created

IMPORTANT RULES:
- Follow the frontend coding standard for test style
- Follow the testing rules for TDD principles
- Use Vitest for unit tests
- Use React Testing Library for React components
- Use MockK-like patterns for mocking

STOP AND ASK FOR CONFIRMATION:
- After the tests are written (before running them)
- After the tests have run (before commit)

Reference:
- the testing rules
- the frontend coding standard → Testing section
```

---

## Example

```text
Analyze the file src/utils/country.ts and create missing unit tests:

[... follow the steps above ...]
```

---

## Expected output

```text
Test analysis completed for src/utils/country.ts

Functions analyzed: 5
- sortCountries() - HAS tests
- getCountryByCode() - MISSING tests
- formatCountryName() - MISSING tests
- isEUCountry() - HAS tests
- getEUCountryList() - MISSING tests

New tests created: 15
- getCountryByCode() - 6 tests (happy path + edge cases + errors)
- formatCountryName() - 4 tests
- getEUCountryList() - 5 tests

Test result:
  15/15 tests pass

Coverage:
  Before: 65% (11/17 functions)
  After:  95% (16/17 functions)
  Increase: +30%

Next step:
Commit the changes with the message:
"Added missing unit tests for country.ts

- getCountryByCode: 6 tests (happy path, edge cases, errors)
- formatCountryName: 4 tests
- getEUCountryList: 5 tests
- Coverage increased from 65% to 95%"
```

---

## Tips

- Start with the simplest functions first
- Use existing tests as a template for style
- Test edge cases: null, undefined, empty arrays, long strings
- Mock external dependencies (API calls, localStorage, etc.)
- Verify that tests actually fail if the code changes (test the tests!)

---

## After test generation

**Verify:**

```bash
pnpm test -- --run <test file>     # Run the new tests
pnpm test -- --coverage            # See the coverage report
```

**Next steps:**
- Commit the tests with a descriptive message
- Consider whether more files need tests
