# Workflows for AI-assisted development

## Table of contents

- [Complexity detection](#complexity-detection)
  - [LOW complexity (Quick Fix)](#low-complexity-quick-fix)
  - [MEDIUM complexity](#medium-complexity)
  - [HIGH complexity](#high-complexity)
- [Problem type routing (Quick Reference)](#problem-type-routing-quick-reference)
- [Branch strategy](#branch-strategy)
- [JIRA issue workflow](#jira-issue-workflow)
  - [Phase 1: Create document structure](#phase-1-create-document-structure)
  - [Phase 2: Analyze the codebase](#phase-2-analyze-the-codebase)
  - [Phase 3: Implement the solution](#phase-3-implement-the-solution)
  - [Phase 4: Verify](#phase-4-verify)
  - [Phase 5: Archive](#phase-5-archive)
- [TODO plan workflow](#todo-plan-workflow)
- [API impact analysis](#api-impact-analysis)
- [Cross-project issues](#cross-project-issues)
- [Workflow optimization](#workflow-optimization)

---

## Complexity detection

**Principle:** Match the scope of the documentation to the complexity of the task.

### LOW complexity (Quick Fix)

**Characteristics:**
- The description mentions **one specific file**
- Simple operations: "remove", "replace", "correct", "update", "fix"
- Affects 1-2 files in total

**Analysis scope:**
- Read ONLY the mentioned file
- Do NOT search the entire codebase

**Documentation:** Short and concise (< 200 lines total)
**Estimate:** Minutes to hours (< 2 hours)

**Examples:**
- "Remove console.log from src/services/utils.js"
- "Fix typo in UserProfile.tsx line 45"

---

### MEDIUM complexity

**Characteristics:**
- The description mentions **one component/module**
- Operations: "refactor", "improve", "modernize", "extend"
- May affect 3-10 files

**Analysis scope:**
- Find files related to the component/module
- Find related tests and usage sites
- Do NOT search wider than necessary

**Documentation:** Moderate detail (100-300 lines total)
**Estimate:** Hours to days (2-16 hours)

**Examples:**
- "Refactor the Stegvelger component"
- "Improve error handling in the api layer"

---

### HIGH complexity

**Characteristics:**
- The description uses **patterns** ("all", "migrate X to Y", "upgrade")
- Large refactorings or architecture changes
- Affects 10+ files

**Analysis scope:**
- Search the codebase broadly for patterns
- Categorize files by complexity
- Analyze API impact (frontend - backend)
- Identify edge cases and risks

**Documentation:** Comprehensive analysis (300-800 lines total)
**Estimate:** Days to weeks (1-10 days)

**Examples:**
- "Migrate all Redux Form components to react-hook-form"
- "Upgrade React 17 to React 18"

---

## Problem type routing (Quick Reference)

| Problem type | Start with documentation | Workflow |
|-------------|------------------------|----------|
| **Frontend UI bug** | `frontend code standard` | Reproduce - Identify component - Check API - TDD |
| **Backend API error** | `backend overview` + `patterns.md` | Identify endpoint - Check ripple effects - TDD |
| **Cross-project** | `API mapping guide` | Backend first - Test - Frontend - Full stack test |
| **Refactoring** | `the testing rules` | Secure tests - Refactor - Verify green tests |
| **Test generation** | `the testing rules` | Read code - Identify edge cases - Write tests |
| **New functionality** | `the workflows rules` | Read JIRA/TODO - Analyze scope - TDD |
| **Database change** | `backend patterns` | Identify ripple effects - Flyway - Test |
| **Performance** | `frontend code standard` | Profile - Find root cause - Benchmark - Optimize |

**Quick reference:**
- **Frontend problem?** See `frontend code standard`
- **Backend problem?** See `backend overview` + `patterns.md`
- **Cross-project?** See `API mapping guide`
- **Testing?** See `the testing rules`
- **Git/Commit?** See `the git rules`

---

## Branch strategy

**Before starting analysis or implementation:**

The AI assistant may work with **multiple repositories** at the same time (e.g. my-app, my-api, etc.). It is critical that the correct branch is checked out in all relevant repositories.

### Why this matters

- The analysis phase reads the API mapping to find which systems are involved
- **If the wrong branch is checked out**, the analysis/implementation may be wrong or incomplete
- The AI assistant **aborts with an error message** if a required repository is missing

### Recommended procedure

**1. Check out the same branch in all relevant repositories:**

```bash
# my-app (frontend)
cd ~/develop/my-app
git checkout feature/PROJ-7637

# my-api (backend)
cd ~/develop/my-api
git checkout feature/PROJ-7637
```

**2. Verify that the repositories are in sync:**

```bash
cd ~/develop/my-app && git pull
cd ~/develop/my-api && git pull
```

### Tracking info in documentation

After analysis/solution, the **Tracking info** section is updated with which repositories and branches were used:

```markdown
## Tracking info

- **JIRA:** [PROJ-7637](https://jira.example.com/browse/PROJ-7637)
- **Last analyzed:** `2025-11-07`

**Repositories used during analysis:**
- **my-app:** `feature/PROJ-7637` @ `abc123de`
- **my-api:** `feature/PROJ-7637` @ `def456ab`
```

---

## JIRA issue workflow

### Overall flow
```text
(Explore) - Create - Analyze - Solve - Verify - Archive
```

**Explore is optional and has no stakes:** `/aide-explore` thinks the
problem through with the user first — no files, no spec. Use it when
the idea or scope is not ready for `/aide-create` yet.

### Phase 1: Create document structure

**What is done:**
1. Fetches the issue from the JIRA API (validation)
2. Assigns the next available number and creates the directory: `specs/<NN>-PROJ-XXXX-slug/`
3. Fills in `1-description.md` with JIRA metadata
4. Creates empty files: `2-analysis.md`, `3-solution.md`, `4-status.md`
5. Stages all new files in git (automatically)

**Output:**
```text
specs/05-PROJ-7894-class-to-functional/
├── 0-README.md            (reading order)
├── 1-description.md       (done)
├── 2-analysis.md           (⏳ empty)
├── 3-solution.md           (⏳ empty)
└── 4-status.md            (⏳ empty)
```

### Phase 2: Analyze the codebase

**What is done:**
1. Reads `1-description.md`
2. **Detects the complexity level** (see [Complexity detection](#complexity-detection))
3. Analyzes the codebase (specific files + line numbers)
4. Identifies affected projects (frontend, backend, etc.)
5. Assesses API impact (see [API impact analysis](#api-impact-analysis))
6. Updates all 4 document files

**Can be re-run** when the codebase changes.

### Phase 3: Implement the solution

**What is done:**
1. Reads `2-analysis.md` and `3-solution.md`
2. Follows a TDD approach:
   - **RED**: Writes tests that prove the problem (should fail)
   - **GREEN**: Implements the solution (the tests should pass)
   - **REFACTOR**: Runs regression tests (verifies nothing broke)
3. Asks for confirmation before each phase
4. Updates `4-status.md` along the way

### Phase 4: Verify

**Manual step:**
1. Run all tests with the project's test command (e.g. `pnpm test -- --run`)
2. Run the project's lint command (e.g. `pnpm run lint`)
3. Build with the project's build command (e.g. `pnpm run build`)
4. Test manually in the browser
5. Run `/ultrareview` for a cloud-based code review of the branch (user-triggered, requires a git repo)
6. Commit changes

### Phase 5: Archive

When the work is done, run `/aide-archive <ID>`:

1. Verifies that `4-status.md` shows finished work
2. Feeds durable knowledge (decisions, conventions, gotchas) back into the
   project's living documentation
3. Stamps the archive date in `4-status.md` and moves the folder to
   `<specs-root>/archive/` — the number is never reused

---

## TODO plan workflow

### Overall flow
```text
Create - Analyze - Solve - Verify - Archive
```

### Phase 1: Create document structure

**What is done:**
1. Assigns a number (next available)
2. Creates the directory: `specs/<NN>-slug-name/`
3. Fills in `1-description.md` with metadata
4. Creates empty files: `2-analysis.md`, `3-solution.md`, `4-status.md`
5. Stages all new files in git (automatically)

**Output:**
```text
specs/17-clean-up-console-log/
├── 0-README.md            (reading order)
├── 1-description.md       (done)
├── 2-analysis.md           (⏳ empty)
├── 3-solution.md           (⏳ empty)
└── 4-status.md            (⏳ empty)
```

### Phase 2-5: Analyze, Solve, Verify and Archive

Same as the [JIRA issue workflow](#jira-issue-workflow).

---

## API impact analysis

**IMPORTANT:** Always assess API impact when analyzing an issue!

### Workflow

1. **Read the API mapping guide**
   - `API mapping guide`
2. **Identify API calls**
   - Search for endpoints in the frontend code
   - Example: `'api/sak/' + sakId`

3. **Look up in the mapping**
   - Use the `API quick reference` for fast lookup
   - Find the exact backend file and line number

4. **Assess the impact**
   - **Frontend only?** UI changes without API changes
   - **Backend only?** Logic changes without contract changes
   - **Both?** New fields, validation, changed API contract

### Example

**JIRA issue:** "Add a 'processing status' field to the case overview"

**Analysis:**
1. Frontend uses: `GET /api/case/{caseId}`
2. The backend endpoint lives in: `my-api/src/.../CaseController.java:156`
3. Assessment: **Both**

**Document in `2-analysis.md`:**
```markdown
## Affected projects

### my-api
- CaseController.java:156 - Add `processingStatus` to the response
- CaseDto.java:42 - Add new field

### my-app
- src/pages/case/CaseOverview.tsx:89 - Show `processingStatus` in the UI
```

---

## Cross-project issues

Many issues require changes in multiple projects.

### Workflow for cross-project issues

1. **Analyze** which projects are affected
2. **Document** in `2-analysis.md`:
   - List of affected files (with line numbers)
   - Dependencies between projects
3. **Implement** in the right order:
   - Often: Backend first, then frontend
   - Reason: The frontend depends on the backend API contract
4. **Test** the entire flow:
   - Backend tests (unit + integration)
   - Frontend tests (unit + e2e)
   - Manual testing (full stack)

---

## Workflow optimization

Based on [Anthropic's official guide](https://www.anthropic.com/engineering/claude-code-best-practices).

### Context management

**Use `/clear` between independent tasks:**
- Keeps performance up
- Prevents earlier context from distracting

**When to use /clear:**
- After completing a JIRA issue or TODO plan
- When switching between independent tasks

### Course correction

**Interrupt and redirect:**
- **Escape:** Abort the ongoing operation and give new instructions
- **Double-tap Escape:** Edit the previous prompt
- **Ask Claude to undo:** "Undo the last change"

**Ask Claude to plan first:**
- "Plan how you want to solve this before writing code"
- "Think hard" for more thorough analysis

### Explore - Plan - Code workflow

**Always follow these steps:**

**1. Explore**
```text
- "Read through SakOversikt.tsx and explain the structure"
- "Find all places where we use validateApplication"
```

**2. Plan**
```text
- "Make a plan for how we should implement this"
- "Think hard about the edge cases"
```

**3. Code (Implement)**
```text
- Write tests first (RED)
- Implement the solution (GREEN)
- Run regression tests (REFACTOR)
```

**4. Commit (Confirm)**
```text
- Manual testing
- Code review
- Git commit
```

### Iterating toward clear goals

**Use measurable targets:**
- **Tests:** Write tests that define the desired behavior
- **Screenshots:** Show the desired design as a target
- **Specifications:** Explicit acceptance criteria

### Checklists for complex tasks

**For large migrations:**

1. Ask Claude to create a Markdown checklist
2. Work systematically through each item
3. Update 4-status.md along the way

**Example:**
```markdown
## Migration plan: Redux to Zustand

- [ ] Migrate `caseSlice.ts` (10 actions)
- [ ] Migrate `userSlice.ts` (5 actions)
- [ ] Update all components using `useSelector`
- [ ] Remove Redux dependencies
- [ ] Run the full test suite
```

---

## Summary

**Three key principles:**
1. **Detect complexity** early and match the documentation to the task
2. Follow the **linear flow**: Create - Analyze - Solve - Verify - Archive
3. Always assess **API impact** (use the mapping)

**Best practices:**
1. Use `/clear` between independent tasks
2. Follow **Explore - Plan - Code - Commit**
3. Iterate toward **clear goals** (tests, screenshots, specifications)
4. Use **checklists** for complex tasks

---

## See also

- [spec-structure.md](./spec-structure.md) - 4-file structure for specs
