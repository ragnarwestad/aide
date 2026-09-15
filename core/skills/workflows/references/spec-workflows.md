# The spec workflow

## Table of contents

- [The workflow](#the-workflow)
  - [Overall flow](#overall-flow)
  - [Phase 1: Create document structure](#phase-1-create-document-structure)
  - [Phase 2: Analyze the codebase](#phase-2-analyze-the-codebase)
  - [Phase 3: Implement the solution](#phase-3-implement-the-solution)
  - [Phase 4: Archive](#phase-4-archive)

---

## The workflow

### Overall flow
```text
(Explore) - Create - Analyze - Implement - Archive
```

**Explore is optional and has no stakes:** `/aide-explore` thinks the
problem through with the user first — no files, no spec. Use it when
the idea or scope is not ready for `/aide-create` yet.

### Phase 1: Create document structure

**What is done:**
1. Takes the title and the description
2. Assigns the next available number and creates the directory: `specs/<NN>-slug/`
3. Fills in `1-description.md` with them
4. Creates empty files: `2-analysis.md`, `3-solution.md`, `4-status.md`
5. Stages all new files in git (automatically)

**Output:**
```text
specs/05-class-to-functional/
├── 0-README.md            (reading order)
├── 1-description.md       (done)
├── 2-analysis.md           (⏳ empty)
├── 3-solution.md           (⏳ empty)
└── 4-status.md            (⏳ empty)
```

### Phase 2: Analyze the codebase

**What is done:**
1. Reads `1-description.md`
2. **Detects the complexity level** (see "Complexity detection" in SKILL.md)
3. Analyzes the codebase (specific files + line numbers)
4. Identifies affected projects (frontend, backend, etc.)
5. Assesses API impact (see [api-impact.md](./api-impact.md))
6. Updates all 4 document files
7. **Reviews the plan** — optional for LOW specs, expected for
   MEDIUM/HIGH. Reviewers with distinct perspectives (feasibility, scope
   guardian, coherence) attack `3-solution.md` BEFORE any test is
   written — where mistakes are cheapest to catch. Findings land in a
   "Plan review" section of `3-solution.md`, and the plan is REVISED for
   every must-fix finding, not just annotated.

**Can be re-run** when the codebase changes.

### Phase 3: Implement the solution

**What is done:**
1. Reads `2-analysis.md` and `3-solution.md`
2. Follows a TDD approach:
   - **RED**: Writes tests that prove the problem (should fail)
   - **GREEN**: Implements the solution (the tests should pass)
   - **REFACTOR**: Runs regression tests (verifies nothing broke)
3. Runs all three through, reporting each one's result — stops only
   when genuinely blocked
4. Updates `4-status.md` along the way

**The phase ends on a green test run** of the project's own suite, with
the lint and build commands green and the work committed — run headless,
the runner runs the suite itself and hands red tests back to the same
session before it gives up. Test by hand in the browser where the change
needs it, and run `/ultrareview` for a cloud-based code review of the
branch when the change warrants one (user-triggered, requires a git repo).

### Phase 4: Archive

When the work is done, run `/aide-archive <ID>`:

1. Verifies that `4-status.md` shows finished work
2. Feeds durable knowledge (decisions, conventions, gotchas) back into the
   project's living documentation
3. Stamps the archive date in `4-status.md` and moves the folder to
   `<specs-root>/archive/` — the number is never reused
4. Lands the spec's branches on the default branch — the code and the
   specs repo alike

---
