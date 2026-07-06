# TDD phases: Detailed workflow

## Phase 1: RED — Write failing tests

1. Read "Step 0" from 3-solution.md
2. Identify all tests to be written
3. Create the test files (follow the testing rules and the frontend coding standard)
4. Run: `pnpm test -- --run <test file>`
5. Verify that the tests FAIL (expected!)
6. **STOP** — ask the user for confirmation

Show:
- Number of tests written
- All fail as expected
- "Ready for the GREEN phase?"

## Phase 2: GREEN — Implement until tests pass

For each step in 3-solution.md:

1. Read the step
2. Implement the code (follow the coding standard)
3. Run: `pnpm test -- --run <test file>`
4. Verify that the relevant tests PASS
5. Repeat for all steps

When all steps are implemented:
6. **STOP** — ask the user for confirmation

Show:
- Number of steps implemented
- All tests pass
- "Ready for the REFACTOR phase?"

## Phase 3: REFACTOR — Quality check and cleanup

```bash
# 1. Full test suite (no regressions)
pnpm test -- --run

# 2. TypeScript (no type errors)
npx tsc --noEmit

# 3. ESLint (no linting errors)
pnpm run eslint

# 4. Build (the build succeeds)
pnpm run build
```

After all checks:
5. Update `reports/XX-slug/4-status.md`
6. Show a summary and confirm completion

## Expected output per phase

### After RED:

```text
PHASE 1: RED PHASE — DONE

Test files created:
- src/__tests__/UserProfile.test.tsx (3 test cases)
- src/__tests__/UserForm.test.tsx (2 test cases)

Status: 5/5 tests fail (expected in the RED phase)

STOP: Ready for the GREEN phase?
```

### After GREEN:

```text
PHASE 2: GREEN PHASE — DONE

Implementation completed:
- Step 1: Added validation in UserProfile.tsx:45
- Step 2: Added field in UserForm.tsx:120

Status: 7/7 tests pass

STOP: Ready for the REFACTOR phase?
```

### After REFACTOR:

```text
PHASE 3: REFACTOR PHASE — DONE

Full test suite: 134 passed
TypeScript check: No errors
ESLint: No errors
Build: Success

IMPLEMENTATION COMPLETED!
```
