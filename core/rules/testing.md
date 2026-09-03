# Testing rules for AI-assisted development

## Table of contents

- [Every change ships with its test](#every-change-ships-with-its-test)
- [Core rule](#core-rule)
- [Test commands](#test-commands)
  - [Unit tests](#unit-tests)
  - [E2E tests (Playwright)](#e2e-tests-playwright)
- [Workflow](#workflow)
  - [Example of a correct workflow](#example-of-a-correct-workflow)
  - [When tests fail](#when-tests-fail)
- [TDD approach](#tdd-approach-test-driven-development)
- [Watch mode](#watch-mode)

---

## Every change ships with its test

**Fix a bug or add functionality → write the test in the same job. Never as a suggestion
afterwards, never as an item on a list of outstanding work.**

The user has to ask for this far too often. The pattern to stop: deliver the code, then offer tests
as a separate follow-up, or list "this has no test coverage" as an outstanding action. Tests are
part of the delivery, like the code compiling.

### What to test

- **The rule, not the rendering.** What would break silently, in a way nobody sees for weeks. Not the
  markup — a test that restates the HTML raises a number and catches nothing.
- **A bug fix gets a test for the bug.** The failure that was reported is the test case.

### Prove the test is worth having

**Revert the fix temporarily and confirm that exactly that test goes red.** A test that passes both
with and without the fix is decoration. This takes thirty seconds and is not optional for a bug fix.

### When a unit test genuinely cannot reach it

Some things only exist in a browser: shadow-DOM internals, anything that depends on where the
camera is pointing, real rendering. Say so plainly, put it in the Playwright suite instead, and say
which spec — but never leave the change with nothing at all.

---

## Core rule

Run a test as soon as you create or modify it, and verify it passes before moving on.

**E2E tests (Playwright) have their own rules** — see [E2E tests (Playwright)](#e2e-tests-playwright);
run them only in projects on the quick-suite list kept there, and ask the user elsewhere. Everything
below about running tests applies to unit tests.

1. Run the new or changed test immediately.
2. Verify that it passes (green ✅). If it fails (red ❌), analyze the error message, fix the
   problem — either the test or the code — and re-run until it passes.
3. Before committing, run the entire test suite to check for regressions.

### Slow tests never block the session

The job itself often takes seconds; verification must not turn that into a long wait while the
user does nothing else.

- Run in the foreground only fast, narrow test files that cover the exact change. Learn which files
  in a repo are slow before running anything broad.
- Run anything slow in the background, announced with what it is and roughly how long, while the
  job and the conversation continue. Report the result when it lands.
- Run the full suite exactly once per job, in the background, before commit — never inline, never
  repeated per iteration.
- When the user is waiting to see something, deploy or show it first and verify in the background.

---

## Test commands

### Unit tests

Use the project's own test command — take it from `AIDE_TEST_CMD` in `.aide/config` if set,
otherwise `testCmd` in the committed manifest, otherwise detect it from the lockfile/build files
(see "Project commands" in the tools-and-scripts rules). Always run it in single-run mode.

Example for a pnpm/Vitest project:

```bash
# All tests (use --run to avoid watch mode)
pnpm test -- --run

# Specific test file
pnpm test -- --run <filename>

# With coverage report
pnpm run test:coverage
```

### E2E tests (Playwright)

**Run the e2e suite where the project's own run is quick and reliable. Keep that list explicit —
on this machine it is currently Atlasaurus (since 3 August 2026) and PaceUp. Elsewhere, ask the
user to run it.**

The list stays short on purpose: a suite that hangs blocks the session for minutes with nothing to
show for it. Where a project's suite is fast, that risk is gone; where it still crawls, ask the
user to run it there instead.

Where it is allowed:

- Say what you are starting and roughly what it costs before launching it — the same courtesy as
  any open-ended job.
- Run it when a change touched interaction behaviour, not as routine after every edit; the
  project's ordinary check command stays the gate.
- Report the result plainly, failures included, with the output.
- Don't let it run unbounded: if a run overshoots what you told the user it would take, kill it,
  say so, and hand the suite back rather than sitting on it.
- Don't use the html reporter — it spawns a server that will not exit.
- Don't list an e2e run as an "outstanding action": the user runs the suite on their own
  initiative too, and reports when it goes red.

---

## Workflow

### Example of a correct workflow

The steps below use a pnpm/Vitest project; swap in the project's own commands.

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

Prove the problem by writing a test that demonstrates the desired behavior (but fails because the
code is not implemented yet).

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

## Watch mode

Run tests so the process exits when they're done. The examples are Vitest; the rule applies to any
runner with a watch or interactive mode (Jest, `gradle --continuous`, `cargo watch`, …).

```bash
# ✅ Runs and exits
pnpm test -- --run                    # Vitest - exits after running
pnpm test -- --run UserProfile.test.tsx  # Specific test

# ❌ Watch mode - the process never exits
pnpm test
pnpm test UserProfile.test.tsx

# ❌ e2e is user-run only, regardless of mode
pnpm run test:e2e
pnpm run test:e2e:ui
```

Why: an AI assistant can't interact with watch mode (it needs manual input to exit), so a process
left in watch mode stays open in the background, has to be killed by hand, and leaves no way to
tell when the tests actually finished. The same failure blocks a CI pipeline, which waits forever,
and breaks the TDD cycle, which needs each run to exit before the next one starts.

### Checking whether test processes are hanging

Kill only processes you started yourself, not every process with a matching name.

```bash
# Check whether your test processes are hanging (do not kill automatically)
ps aux | grep vitest
ps aux | grep playwright

# See PID and command to identify your processes
ps aux | grep "[v]itest"    # Shows vitest processes
ps aux | grep "[p]laywright" # Shows playwright processes

# Kill only processes you started yourself (use the PID from the output above)
kill <PID>                   # Replace <PID> with the process ID

# Example:
# ps aux | grep vitest
# > ragnar  12345  ... node .../vitest/...
# kill 12345
```

Don't use `pkill -f node` (kills every node process) or `pkill -f vitest` without checking first —
use `ps aux` to identify your own processes, then `kill <PID>` for those specifically.

---

## Summary

1. Every fix and every new feature ships with its test, in the same job — revert the fix once to
   confirm the test catches it
2. Run unit tests immediately after creating or modifying them
3. Verify that all tests pass before committing
4. Use TDD (Red → Green → Refactor) for new features
5. Run the e2e suite only where it's quick (per the E2E section's list), say so first, and ask the
   user to run it elsewhere
