---
name: task-workflow-assistant
description: >-
  Structured analysis and planning of JIRA issues and TODO plans.
  Use when: analyzing a JIRA issue, creating a TODO plan, identifying affected files.
  Do NOT use for: pure code implementation, TDD cycle, code review
effort: high
---

# Task Workflow Assistant

## When to use this skill

- You are analyzing a JIRA issue
- You are creating a TODO plan
- You are identifying affected files
- You are estimating complexity

---

## 4-file structure

### 1. description.md

**Content:**
- JIRA data (title, description, acceptance criteria)
- Scope (what will be done, what will NOT be done)
- Prerequisites and dependencies

**Structure:** Follow the `report structure` § 1-description

### 2. analysis.md

**Content:**
- Affected files (with **file:line** references)
- Complexity (simple/medium/complex)
- Risk analysis
- API impact (frontend ↔ backend)

**Structure:** Follow the `report structure` § 2-analysis

**Example:**
```markdown
## Affected files

### Frontend
- `src/components/UserProfile.tsx:45` - Must update form validation
- `src/api/userApi.ts:12` - Must add new endpoint call

### Backend
- `com/example/api/UserController.kt:78` - Must update DTO
- `com/example/domain/User.kt:23` - Must add new field
```

### 3. solution.md

**Content:**
- TDD-based implementation plan
- Step 0: Write tests (RED phase)
- Steps 1-N: Implementation (GREEN phase)
- Testing strategy (REFACTOR phase)
- Each step: concrete, testable, with time estimate

**Structure:** Follow the `report structure` § 3-solution

**Example:**
```markdown
## Implementation plan

### Step 0: Write tests (RED phase)
- [ ] `UserProfile.test.tsx` - Test new validation (30 min)
- [ ] `UserController.test.kt` - Test new endpoint (30 min)

### Step 1: Implement backend (GREEN phase)
- [ ] Add field to `User.kt` (15 min)
- [ ] Update `UserController.kt` (30 min)
- [ ] Run tests - verify that they pass (10 min)

### Step 2: Implement frontend (GREEN phase)
- [ ] Update `UserProfile.tsx` (45 min)
- [ ] Update `userApi.ts` (15 min)
- [ ] Run tests - verify that they pass (10 min)

### Step 3: Refactoring and quality assurance (REFACTOR phase)
- [ ] TypeScript check: `npx tsc --noEmit` (5 min)
- [ ] ESLint: `pnpm run eslint` (5 min)
- [ ] All tests: `pnpm test -- --run` (10 min)
```

### 4. status.md

**Content:**
- Progress tracking
- Challenges and solutions
- Tests (status, coverage)
- Deployment status

**Structure:** Follow the `report structure` § 4-status

---

## Analyze impact

### Frontend vs Backend

Use the API mapping to identify:
- Is this a frontend bug (parsing/rendering)?
- Is this a backend bug (data/logic)?
- Does it affect both layers?

### API impact

```markdown
## API impact

### Changed endpoint
- `GET /api/user/{id}` → Response format changed
- Affected frontend files:
  - `src/api/userApi.ts:12`
  - `src/components/UserProfile.tsx:45`
```

### Complexity

**Simple:**
- 1-2 files affected
- No API changes
- < 2 hours of estimated work

**Medium:**
- 3-5 files affected
- Minor API changes
- 2-8 hours of estimated work

**Complex:**
- > 5 files affected
- Major API changes or new endpoints
- > 8 hours of estimated work
- Requires deeper reasoning (Extended Thinking)

---

## References

- `workflow rules` - Complete workflow documentation
- `documentation standard` - 4-file structure standard
- API mapping guide
