# aide — Shared instructions

Instructions for AI-assisted development focused on:
- JIRA issues with a 4-file documentation structure
- Test-Driven Development (TDD: RED → GREEN → REFACTOR)
- Automated codebase analysis with file:line references
- API impact analysis (frontend ↔ backend)

---

# Tools and scripts

## Table of contents

- [Skills](#skills)
- [Project commands](#project-commands)
- [Per-project configuration (.aide/config)](#per-project-configuration-aideconfig)
- [Spec storage](#spec-storage)

---

## Skills

Skills are loaded from `~/.claude/skills/` — use the `/` syntax.

Available skills:

- `/aide-explore` - No-stakes thinking partner before a spec exists (creates nothing)
- `/aide-create` - Create JIRA/TODO documentation
- `/aide-analyze` - Analyze the codebase
- `/aide-review-plan` - Review the plan before implementation (feasibility, scope, coherence)
- `/aide-manifest` - Draft or refresh the project manifest (.aide/project.yaml)
- `/aide-implement` - Implement with TDD
- `/aide-archive` - Archive a finished spec and feed durable knowledge back into the docs
- `/aide-resolve` - Finish a merge the Merge button refused for a conflict, and run the tests
- `/aide-to-pdf` - Render the specs to PDF
- `/tdd-coach` - Test-Driven Development methodology

---

## Project commands

Run the project's own test/lint/build commands **automatically** without asking
the user. Detect them — never assume a toolchain:

1. **Config first:** if `.aide/config` in the project root sets `AIDE_TEST_CMD`,
   `AIDE_LINT_CMD` or `AIDE_BUILD_CMD`, use those.
2. **Otherwise detect** from what the project ships:

| Found in the project root | Toolchain | Typical commands |
|---------------------------|-----------|------------------|
| `pnpm-lock.yaml` | pnpm | `pnpm test -- --run`, `pnpm run lint`, `pnpm run build` |
| `package-lock.json` | npm | `npm test`, `npm run lint`, `npm run build` |
| `yarn.lock` | yarn | `yarn test`, `yarn lint`, `yarn build` |
| `gradlew` | Gradle | `./gradlew test`, `./gradlew build` |
| `pom.xml` | Maven | `mvn test`, `mvn verify` |
| `pytest.ini` / `pyproject.toml` | pytest | `python -m pytest` (prefer the project's venv) |
| `go.mod` | Go | `go test ./...`, `go build ./...` |
| `Cargo.toml` | Cargo | `cargo test`, `cargo build` |

For JS/TS projects, read `package.json` `scripts` for the exact names — the
table's commands are the usual defaults, not a promise. Test runners must run
in single-run mode, never watch mode (see the testing rules).

**When to run what:**

- New files created → Run `git add <file>` automatically
- Implementation done → Run the project's test/typecheck/lint commands automatically

---

## Per-project configuration (.aide/config)

Optional file in the project root: `.aide/config`, plain `KEY=value` lines
with `#` comments. Recognized keys:

| Key | Purpose |
|-----|---------|
| `AIDE_JIRA_BASE_URL` | JIRA root, e.g. `https://jira.mycompany.com` — issue links become `<url>/browse/<KEY>` |
| `AIDE_TEST_CMD` | Overrides the detected test command |
| `AIDE_LINT_CMD` | Overrides the detected lint command |
| `AIDE_BUILD_CMD` | Overrides the detected build command |
| `AIDE_WORKTREE_LINKS` | Space-separated repo-relative paths a headless run needs but git does not carry — `.venv dashboard/node_modules` and the like |
| `AIDE_INSTALL_CMD` | What installing this project means on THIS machine — run by the dashboard after the project's own code is merged |

`AIDE_WORKTREE_LINKS` exists because `aide-run-spec` gives every run a
`git worktree` of its own, and a worktree carries **tracked files only**:
every gitignored path is simply absent. In a project whose test command
lives behind one of them — pytest in `.venv`, a suite needing
`node_modules` — the step then fails for a reason that has nothing to do
with its change. Each listed path is symlinked in from the main checkout
when it exists there, and excluded from the commit. Paths are relative to
the repo root; an absolute path, or one containing `..`, is refused by
name. Which paths matter cannot be derived without guessing, so the
project states them.

`AIDE_INSTALL_CMD` exists because merged is not deployed. For a project
that installs itself somewhere — aide puts its scripts in
`~/.local/bin` — code reaching the default branch changes nothing on
the machine until the install runs, and the dashboard's Merge button
said "merged" while the host went on running the old version. The value
is an argv, split on whitespace and run with **no shell**, in the
project's own checkout, bounded by a timeout; a failure is reported
beside the merge and never turns a completed merge back into a failed
one. Without the key nothing is run, and the page says plainly that
deploying is still a hand step. `aide`'s own value is
`implementations/claude-code/install.sh` — any one of the three per-tool
installers reinstalls the shared scripts, and Claude Code is this repo's
priority-1 tool.

Everything is optional: commands fall back to detection, and without
`AIDE_JIRA_BASE_URL` the skills ask the user for the URL instead of guessing.
Shell scripts read the file via `aide_config_get KEY <project-root>` from
`_aide-spec-lib.sh`.

**The project manifest is the config's team-owned sibling:**
`.aide/project.yaml` describes what the project IS (stack, dependencies,
deployment, logging, statistics, reports, docs) and belongs in git.
`/aide-manifest` drafts and refreshes it; `/aide-analyze` reads it for
project context. Only `.aide/config` is personal and gitignored — never
ignore the whole `.aide/` directory.

---

## Spec storage

The specs root is per-project configuration: `AIDE_SPECS_PATH` in
`.aide/config` in the project root. If the key is set, specs are stored
there (not in the project's `specs/`); when the specs root lies outside
the project root, do **not** run `git add` for specs in the project's
repo (they live in another repo). Without the key, specs go to `specs/`
in the project root. There is no environment variable.

---

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
  - [Phase 2.5: Review the plan](#phase-25-review-the-plan)
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

Start every problem type from the project's OWN documentation when it has
any (a coding standard, an architecture overview, API docs) — check the
README and the docs folder first. A project without such docs is normal:
the code itself is the source, so search it instead of hunting for
documents.

| Problem type | Workflow |
|-------------|----------|
| **Frontend UI bug** | Reproduce - Identify component - Check API - TDD |
| **Backend API error** | Identify endpoint - Check ripple effects - TDD |
| **Cross-project** | Backend first - Test - Frontend - Full stack test |
| **Refactoring** | Secure tests - Refactor - Verify green tests |
| **Test generation** | Read code - Identify edge cases - Write tests |
| **New functionality** | Read JIRA/TODO - Analyze scope - TDD |
| **Database change** | Identify ripple effects - Migration script - Test |
| **Performance** | Profile - Find root cause - Benchmark - Optimize |

**Quick reference:**
- **Testing?** See `the testing rules`
- **Git/Commit?** See `the git rules`
- **Everything else:** the project's own docs if they exist, the code if not

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

After analysis AND solution, the **Tracking info** section records which
repositories and branches were used — one compact `Repo` line per repo,
in the same style as the other fields:

```markdown
## Tracking info

- **JIRA:** [PROJ-7637](https://jira.example.com/browse/PROJ-7637)
- **Last analyzed:** `2025-11-07`
- **Repo:** `my-app/feature/PROJ-7637 @ abc123de`
- **Repo:** `my-api/feature/PROJ-7637 @ def456ab`
```

The `Repo` lines belong in BOTH `2-analysis.md` and `3-solution.md` —
the solution is written against a state of the code, and that state must
be recorded where the solution lives.

---

## JIRA issue workflow

### Overall flow
```text
(Explore) - Create - Analyze - (Review) - Solve - Verify - Archive
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

### Phase 2.5: Review the plan

**Optional for LOW specs, expected for MEDIUM/HIGH.** `/aide-review-plan`
lets reviewers with distinct perspectives (feasibility, scope guardian,
coherence) attack `3-solution.md` BEFORE any test is written — where
mistakes are cheapest to catch. Findings land in a "Plan review" section
of `3-solution.md`, and the plan is REVISED for every must-fix finding,
not just annotated.

### Phase 3: Implement the solution

**What is done:**
1. Reads `2-analysis.md` and `3-solution.md`
2. Follows a TDD approach:
   - **RED**: Writes tests that prove the problem (should fail)
   - **GREEN**: Implements the solution (the tests should pass)
   - **REFACTOR**: Runs regression tests (verifies nothing broke)
3. Runs all three phases through, reporting each phase's result —
   stops only when genuinely blocked
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

1. **Check what API documentation the project has**
   - An OpenAPI/Swagger spec, an API mapping document, or nothing —
     all three are normal
2. **Identify API calls**
   - Search for endpoints in the frontend code
   - Example: `'api/case/' + caseId`

3. **Locate the backend side**
   - With API docs: look the endpoint up there
   - Without: search the backend code for the route (controller
     annotations, router registrations) — find the exact file and line

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

---

# LLM coding discipline

Behavioral rules that guard against two common LLM failures: silent
assumptions and scope creep. Inspired by Andrej Karpathy's observations
on where language models fall short when writing code.

**Trade-off:** These rules favor caution over speed. On trivial tasks,
use judgment.

## Table of contents

- [Think before you code](#think-before-you-code)
- [Surgical changes](#surgical-changes)
- [See also](#see-also)

---

## Think before you code

**Don't assume. Don't hide confusion. Surface the trade-offs.**

Before implementing:

- State your assumptions explicitly. If you are unsure, ask.
- If multiple interpretations exist, lay them out — don't silently pick one.
- If a simpler approach exists, say so. Push back when there is reason to.
- If something is unclear, stop. Put the confusion into words. Ask.

---

## Surgical changes

**Touch only what you must. Clean up only your own mess.**

When modifying existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Follow the existing style, even if you would have done it differently.
- If you discover unrelated dead code, mention it — don't delete it.

When your changes leave orphaned code behind:

- Remove imports, variables, and functions that *your* changes made unused.
- Don't remove dead code that was already there, unless asked to.

Rule of thumb: every line you change should be directly traceable to what
the user asked for.

---

## See also

Two related Karpathy principles already have their own coverage here — use
them rather than duplicating:

- **Simplicity first** (minimal code, no speculative abstraction) — the `/code-review` skill
- **Goal-driven execution** (verifiable success criteria, RED → GREEN → REFACTOR) — `testing.md` and `/tdd-coach`

---

# Git rules for AI-assisted development

## Table of contents

- [Staging new files](#staging-new-files)
  - [Core rule](#core-rule)
  - [Example](#example)
- [File renaming and conversion](#file-renaming-and-conversion)
  - [Core rule](#core-rule-1)
  - [Workflow for JS to TS conversion](#workflow-for-js-to-ts-conversion)
- [Commit messages](#commit-messages)
  - [Format](#format)
  - [Good examples](#good-examples)
- [Pushing and push status](#pushing-and-push-status)
- [Summary](#summary)

---

## Staging new files

### Core rule
**Automatically add new files YOU have created, but NEVER any other files!**

### ❌ FORBIDDEN
- `git add .` (adds ALL files, including generated/unwanted ones)
- `git add -A` (adds ALL files, including generated/unwanted ones)
- Adding files you did NOT create yourself (node_modules, build output, generated files, etc.)

### ✅ CORRECT approach
1. When you have created NEW files (documentation, code, tests), run `git add` **automatically** for them
2. Use explicit file names: `git add specs/<NN>-PROJ-7890-slug/description.md` (not `git add .`)
3. Only add files YOU wrote/created yourself
4. NEVER add:
   - Generated files (build output, coverage reports)
   - Dependencies (node_modules, vendor)
   - IDE files (.idea/, *.swp)
   - Temporary files

### Note
Modified files (already tracked) do not need `git add` - the user handles committing in their IDE.

### Example
```bash
# You have created 4 new markdown files
git add specs/<NN>-PROJ-7890-slug/description.md
git add specs/<NN>-PROJ-7890-slug/analysis.md
git add specs/<NN>-PROJ-7890-slug/solution.md
git add specs/<NN>-PROJ-7890-slug/status.md

# Or all at once:
git add specs/<NN>-PROJ-7890-slug/*.md
```

---

## File renaming and conversion

### Core rule
**ALWAYS use `git mv` to preserve git history when renaming files!**

### ❌ FORBIDDEN (loses history)
```bash
# Deleting the old file and creating a new one
rm src/utils/country.js
# create new src/utils/country.ts
git add src/utils/country.ts
```

### ✅ CORRECT (preserves history)
```bash
# Use git mv to preserve commit history
git mv src/utils/country.js src/utils/country.ts
git mv src/components/UserProfile.jsx src/components/UserProfile.tsx
```

### Why this matters
- Preserves the entire commit history (who changed what, when, why)
- Git understands that it is the same file, just with a new name
- `git blame` and `git log` work correctly
- The history shows up in the IDE and on GitHub

### Workflow for JS to TS conversion
1. `git mv old.js new.ts` (first!)
2. Convert the contents to TypeScript
3. `git add new.ts` (the changes)
4. Commit

**This rule ALWAYS applies to JS→TS/JSX→TSX conversion!**

---

## Commit messages

### Format
**Always English, always in the imperative mood (not past tense).**

### ❌ NEVER Co-Authored-By
- NEVER add `Co-Authored-By` lines to commit messages
- This applies to all variants (`Claude`, `Copilot`, `GPT`, etc.)

### Good examples
- "Add automatic git add for new files"
- "Remove user-specific paths from settings.json"
- "Update documentation with hook explanation"
- "Convert UserProfile.jsx to TypeScript"
- "Add unit tests for country.ts"

### ❌ Wrong (past tense/Norwegian)
- "Added automatic git add for new files"
- "Removed user-specific paths"
- "Updated documentation"
- "Konverterte UserProfile.jsx til TypeScript"
- "La til enhetstester for country.ts"

### Structure

```text
<What the change does, in the imperative mood>

<Optional: why, context, or details>
```

**Example:**

```text
Add unit tests for country.ts

Test getCountryName(), getCountryCode(), and edge cases.
Preparation before the JS to TS conversion.
```

---

## Pushing and push status

### Core rule
**Never push, and never talk about push/deploy status. The user pushes from the IDE.**

### ❌ NEVER
- Run `git push` unless the current request itself explicitly asks for it («og push» once is not a standing instruction)
- Report push status after a commit: no «N commits ahead of origin», no «husk å pushe», no «remember to push»
- Rephrasings of the same claim: «tre commits ligger klare», «goes out in the same deploy», «when you push these»
- Count commits from memory of what was pushed earlier — the user pushes continuously from the IDE, so any mental model of origin is stale

### ✅ CORRECT approach
1. After committing: state what was committed — full stop
2. Only if the user asks directly about push status: run `git status -sb` + `git log origin/main..main --oneline` **in the same reply** and report the actual result

### Why
The AI repeatedly reported stale push status computed from memory (four separate incidents in July 2026), and the user had to correct it each time. Any statement implying what is or is not on origin requires running git first — and unprompted, it should simply not be made.

A sixth incident (2026-08-06) shows the sneakiest form: mid-explanation of a production issue, the
phrase «fiksen ligger nå i en lokal commit, og bygges … når den er pushet» — not an answer to a
status question, just a subordinate clause implying the commit was not on origin. It was wrong (the
user had already pushed from the IDE, as always) and derailed the whole answer. The trigger for
running git is not "the user asked about push" — it is **any sentence about to contain the words
lokal/pushet/origin or their meaning**.

### The rule generalizes to ALL git state
A fifth incident (2026-07-27) was the same error outside push status: the AI warned that "another
session has uncommitted changes in these files right now", based on file-change notifications seen
minutes earlier — the other session had committed half an hour before. **Every claim about repository
state — uncommitted changes, what another session/person has or hasn't landed, ahead/behind, staged
content — requires running `git status`/`git log` in the same reply the claim is made.** Observations
from earlier in the conversation are history, not current state.

---

## Summary

**Four golden rules:**
1. ✅ Use `git add` with explicit file names for NEW files you have created
2. ✅ Use `git mv` when renaming files (preserves history)
3. ✅ Write commit messages in English, in the imperative mood
4. ❌ Never push, and never mention push/deploy status — the user pushes from the IDE

**This ALWAYS applies - in commands, agents, and normal interaction alike!**

---

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
- [Watch mode warnings](#watch-mode-warnings)

---

## Every change ships with its test

**Fix a bug or add functionality → write the test in the SAME job. Never as a suggestion afterwards,
never as an item on a list of outstanding work.**

The user has to ask for this far too often. The pattern to stop: deliver the code, then offer tests as
a separate follow-up, or list "this has no test coverage" as an outstanding action. Tests are part of
the delivery, like the code compiling.

### What to test

- **The RULE, not the rendering.** What would break silently, in a way nobody sees for weeks. Not the
  markup — a test that restates the HTML raises a number and catches nothing.
- **A bug fix gets a test for the bug.** The failure that was reported is the test case.

### Prove the test is worth having

**Revert the fix temporarily and confirm that exactly that test goes red.** A test that passes both
with and without the fix is decoration. This takes thirty seconds and is not optional for a bug fix.

### When a unit test genuinely cannot reach it

Some things only exist in a browser: shadow-DOM internals, anything that depends on where the camera
is pointing, real rendering. Say so plainly, put it in the Playwright suite instead, and say which
spec — but never leave the change with nothing at all.

---

## Core rule

**ALWAYS run tests when you create or modify them!**

**E2E tests (Playwright) have their own rules** — see [E2E tests (Playwright)](#e2e-tests-playwright); the AI runs them only in projects on the quick-suite list kept there, and asks elsewhere. Everything below about running tests applies to UNIT tests.

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

### Unit tests

Use the project's own test command — take it from `AIDE_TEST_CMD` in
`.aide/config` if set, otherwise detect it from the lockfile/build files
(see "Project commands" in the tools-and-scripts rules). Always in
single-run mode.

Example for a pnpm/Vitest project:

```bash
# All tests (ALWAYS use --run to avoid watch mode!)
pnpm test -- --run

# Specific test file
pnpm test -- --run <filename>

# With coverage report
pnpm run test:coverage
```

### E2E tests (Playwright)

**The AI may run the e2e suite where the project's own run is quick and reliable. Keep that list
explicit — on this machine it is currently Atlasaurus (since 3 August 2026) and PaceUp. Elsewhere,
ask the user to run it.**

The ban was absolute until then, for one reason: the runs hung. A suite launched by the AI blocked the
session for many minutes with nothing to show for it, and it happened often enough that the user said so
several times, with emphasis. That is what changed — the runs are fast now, not the reasoning. If a
suite in another project still crawls, the old rule stands there.

Where it is allowed:

- ✅ Say what you are starting and roughly what it costs BEFORE launching it — the same courtesy as any
  open-ended job
- ✅ Run it when a change touched INTERACTION behaviour, not as routine after every edit; the
  project's ordinary check command stays the gate
- ✅ Report the result plainly, failures included, with the output
- ❌ Never let it run unbounded: if a run overshoots what you told the user it would take, kill it, say
  so, and hand the suite back rather than sitting on it
- ❌ Never the html reporter — it spawns a server that will not exit
- ❌ Never list an e2e run as an "outstanding action": the user runs the suite on his own initiative
  too, and reports when it goes red

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
The examples are Vitest; the rule applies to any runner with a watch or interactive mode
(Jest, `gradle --continuous`, `cargo watch`, …).

```bash
# ✅ CORRECT - Tests run and the process exits
pnpm test -- --run                    # Vitest - exits after running
pnpm test -- --run UserProfile.test.tsx  # Specific test

# ❌ WRONG - Watch mode (the process NEVER exits)
pnpm test                             # Starts in watch mode
pnpm test UserProfile.test.tsx        # Watch mode

# ❌ WRONG for the AI regardless of mode - e2e is user-run only
pnpm run test:e2e
pnpm run test:e2e:ui
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

**Five golden rules:**
1. ✅ **Every fix and every new feature ships with its test, in the same job** — and revert the fix once to prove the test catches it
2. ✅ Run unit tests **immediately** after creating/modifying them
3. ✅ Verify that **all tests pass** before committing
4. ✅ Use **TDD** (Red → Green → Refactor) for new features
5. ✅ **Run the e2e suite only where it is quick** (per the E2E section's list) and say so first; ask the user to run it where it is not

**This rule ALWAYS applies - testing is not optional!**

---

# Documentation standard

## Table of contents

- [General rules for all documents](#general-rules-for-all-documents)
  - [Document structure](#document-structure)
  - [Table of contents](#table-of-contents-1)
  - [Formatting](#formatting)
- [Markdown guidelines](#markdown-guidelines)
  - [Code blocks](#code-blocks)
  - [Numbered lists](#numbered-lists)
  - [Emojis](#emojis)
- [Best practices for AI-assisted documentation](#best-practices-for-ai-assisted-documentation)
  - [Visual documentation](#visual-documentation)
  - [Related resources and URLs](#related-resources-and-urls)
  - [Specific instructions](#specific-instructions)
  - [File references](#file-references)
- [See also](#see-also)

---

## General rules for all documents

These rules apply to ALL markdown documents in the project.

### Document structure

All documents must follow this structure:

```markdown
# Document title

## Table of contents

- [Section 1](#section-1)
  - [Subsection 1.1](#subsection-11)
- [Section 2](#section-2)

---

## Section 1

Content...
```

### Table of contents

**Requirements:**
- ALL documents MUST have a table of contents — no length threshold
- Include up to 3 levels (`##`, `###` and `####`) whenever they exist — EVERY real heading in the
  document gets a TOC entry (stated by the user 9 Aug 2026 after seven ideal-subsections were missing
  from a TOC). Headings inside code fences are not headings and stay out
- Place it AT THE VERY TOP, directly after the `# Title` — NEVER any chapter, purpose statement or
  other content before it (stated by the user 9 Aug 2026 after a doc carried an intro chapter above
  its TOC). An intro/purpose text becomes the FIRST CHAPTER after the TOC, like everything else.
- The heading must be `## Table of contents` (no emoji)

**Format:**
```markdown
## Table of contents

- [Main section](#main-section)
  - [Subsection](#subsection)
    - [Sub-subsection](#sub-subsection)
```

### Formatting

**Titles and headings:**
- Document title: `# Title` (only one per document)
- Main sections: `## Section`
- Subsections: `### Subsection`
- No emojis in headings (causes problems with anchor links)

**Separators:**
- Use `---` between logical sections
- Always `---` after the table of contents

---

## Markdown guidelines

### Code blocks

**Always specify the language at the START:**
- `tsx` for code with JSX (React: `<Component />`)
- `typescript` for TypeScript without JSX
- `bash` for shell commands
- `markdown` for markdown examples
- `text` for general output

**Why:** IDEs parse code blocks and produce warnings if the syntax does not match.

**CRITICAL: Closing code blocks:**

Code blocks are ALWAYS closed with just three backticks - NEVER with a language specifier:

````markdown
```bash
echo "Hello"
```
````

**WRONG (common AI mistake):**

````markdown
```bash
echo "Hello"
```text
````

**Why this matters:**
- ` ```text` as a closing fence breaks markdown parsing
- Pandoc and other converters interpret it as the start of a new code block
- HTML generation fails with broken code blocks
- Anchor links can end up broken

**Before/After code examples:**

Always split "Before" and "After" into SEPARATE code blocks:

````markdown
**Before:**
```tsx
const [value, setValue] = useState();
```

**After:**
```tsx
const value = useSelector(state => state.value);
```
````

**Why:** Avoids redeclaration errors (same variable name in a single code block).

### Numbered lists

**Always start at 1 after a header/section break:**

```markdown
#### Files to change:

1. file1.tsx
2. file2.tsx

#### Files to test:

1. test1.tsx   (CORRECT - starts at 1)
2. test2.tsx
```

**Why:** Markdown linters expect new lists to start at 1.

### Emojis

**Do NOT use emojis in section headings (## headings):**

```markdown
## 📋 Table of contents   (WRONG - emoji in heading)
## Table of contents      (CORRECT)
```

**Why:** Markdown processors strip emojis from heading IDs, which causes MD051 errors (anchor link mismatch).

**Emojis are OK in:**
- Content and body text
- Lists and tables
- Metadata fields

**See also:** [MARKDOWN_LINTING.md](./MARKDOWN_LINTING.md) for detailed linting rules.

---

## Best practices for AI-assisted documentation

### Visual documentation

**Use screenshots and design mocks when relevant:**
- Include screenshots of UI problems or bugs
- Attach design mocks to show the desired end result
- Create an assets folder: `assets/` in the document folder
- Reference images in markdown: `![Description](./assets/screenshot.png)`

**Why:** Modern AI assistants are multimodal and can iterate visually toward a target image.

**Example:**
```markdown
## Problem

Datepicker shows the wrong format in Safari:

![Safari bug](./assets/safari-datepicker-bug.png)

Desired result:

![Design mock](./assets/datepicker-design.png)
```

### Related resources and URLs

**Include links to external resources:**
- JIRA issues: `https://jira.example.com/browse/PROJ-XXXX`
- Confluence documentation
- Design documents (Figma, Sketch)
- API documentation (Swagger, OpenAPI)

**Why:** URLs give AI assistants access to up-to-date documentation and context.

### Specific instructions

**Be explicit and detailed in descriptions:**

**Vague example:**
```markdown
## Problem
Add tests for foo.tsx
```

**Specific example:**
```markdown
## Problem
Write unit tests for `validateApplicationForm()` in foo.tsx:156.
Test the following edge cases:
- Invalid national identity number (11 digits, but wrong check digit)
- Missing required fields (name, address)
- Date of birth in the future

Avoid mocks for validation - use real test data.
```

**Why:** Specific instructions yield a significantly higher success rate.

### File references

**Use concrete file paths:**
- Name exact files: `src/components/CaseOverview.tsx`
- Use line numbers: `CaseOverview.tsx:123-145`

**Why:** Helps AI assistants locate the right resources without searching.

---

## See also

- [spec-structure.md](./spec-structure.md) - 4-file structure for JIRA/TODO reports
- [MARKDOWN_LINTING.md](./MARKDOWN_LINTING.md) - Markdown linting rules

---

# Markdown Linting

## Table of contents

- [Overview](#overview)
- [Usage](#usage)
- [Configuration](#configuration)
- [Responsibilities](#responsibilities)
- [Common errors and solutions](#common-errors-and-solutions)
  - [MD029: List numbering](#md029-list-numbering)
  - [MD040: Missing code block language](#md040-missing-code-block-language)
  - [MD051: Broken anchor link](#md051-broken-anchor-link)
  - [Common AI mistake: Closing a code block with a language](#common-ai-mistake-closing-a-code-block-with-a-language)

---

## Overview

This workspace uses `markdownlint-cli2` via `npx` to catch markdown errors before they are committed.

**Focus areas:**
1. **List numbering (MD029)** - Numbered lists must restart at 1 after headers
2. **Anchor links (MD051)** - TOC links must match actual heading anchors
3. **Code block language (MD040)** - All code blocks must specify language (tsx, typescript, bash, etc.)

## Usage

### Check all markdown files

```bash
npx markdownlint-cli2 '**/*.md'
```

### Automatically fix what can be fixed

```bash
npx markdownlint-cli2 --fix '**/*.md'
```

## Configuration

See `.markdownlint-cli2.jsonc` for the rules.

**Important:** The configuration is minimal and focuses ONLY on the critical issues we have had problems with.

## Responsibilities

**ALL AI implementations (Claude Code, Cursor, Junie, Codex, etc.):**
- Must ALWAYS run linting on markdown files after writing/editing/moving them
- Must fix all MD029, MD040 and MD051 errors before the task is done
- Command: `npx markdownlint-cli2 <file.md>` or `npx markdownlint-cli2 '**/*.md'`

**Manual check (optional):** You can run linting to double-check.

## Common errors and solutions

### MD029: List numbering

**Wrong:**
```markdown
### My Header

3. First item
4. Second item
```

**Solution:**
```markdown
### My Header

1. First item
2. Second item
```

### MD040: Missing code block language

**Wrong:**
```markdown
\```
const foo = 'bar';
\```
```

**Solution:**
```markdown
\```typescript
const foo = 'bar';
\```
```

**Important:** Use `tsx` for React/JSX code, not `typescript`.

### MD051: Broken anchor link

**Wrong:**
```markdown
- [My Section](#my-section)

## 1. My Section
```

**Solution:**
```markdown
- [My Section](#1-my-section)

## 1. My Section
```

Or update the HTML anchor:
```markdown
<a id="my-section"></a>
## 1. My Section
```
to:
```markdown
<a id="1-my-section"></a>
## 1. My Section
```

### Common AI mistake: Closing a code block with a language

**Wrong (not caught by the linter, but breaks HTML generation):**

````markdown
```bash
echo "Hello"
```text
````

**Solution:**

````markdown
```bash
echo "Hello"
```
````

**Why this happens:**
- AI assistants (Claude, Copilot, etc.) sometimes write ` ```text` as a closing fence
- This is NOT valid markdown - code blocks are ALWAYS closed with just ` ``` `
- Pandoc and other converters interpret ` ```text` as the START of a new code block
- The result is broken HTML with wrong code blocks and broken anchor links

**Preventive fix:**
- The `aide-generate-html` script corrects this automatically
- But the source should be fixed - see [DOCUMENTATION_STANDARD.md](./DOCUMENTATION_STANDARD.md#code-blocks)

---


# Spec structure for JIRA and TODO

## Table of contents

- [Overview](#overview)
- [File structure](#file-structure)
  - [1-description](#1-description)
  - [2-analysis](#2-analysis)
  - [3-solution](#3-solution)
  - [4-status](#4-status)
- [Separation of content](#separation-of-content)
- [Differences JIRA vs TODO](#differences-jira-vs-todo)
- [Templates](#templates)
- [See also](#see-also)

---

## Overview

4 standardized files per issue/plan:

```text
specs/<NN>-slug/          # flat structure, same for JIRA and TODO
├── 1-description.md        # (JIRA: the PROJ key is part of the slug)
├── 2-analysis.md
├── 3-solution.md
└── 4-status.md
```

**Roles:**
1. **1-description.md** - Main entry point: The problem as reported
2. **2-analysis.md** - Detailed analysis: Mapping and findings
3. **3-solution.md** - Scope, behavior delta, acceptance criteria, risk and implementation plan with a TDD approach
4. **4-status.md** - Living document: Progress and status

---

## File structure

### 1-description

**Purpose:** Describe the problem as it was reported.

**Structure:**
```markdown
# [Title]

## Table of contents

- Metadata
- Description
- Problem

---

## Metadata

**JIRA:** Table with type, status, priority, reporter, assignee
**TODO:** Number, created date, expected duration

---

## Description

**This field can be edited manually to add:**
- Extra context or clarifications
- Specific technical requirements
- Clarifications from meetings/discussions

---

## Problem

[Description copied from JIRA or written by the developer]

```

**Key points:**
- Table of contents for quick navigation
- Metadata table (JIRA/TODO-specific)
- The Description section is editable for manual additional information
- The Problem section is copied verbatim (do not rewrite)
- No code examples (they belong in 3-solution.md)
- No acceptance criteria (they are part of the solution — 3-solution.md)
- No scope or estimate (they are commitments about the solution — 3-solution.md)
- Optionally a `Depends on:` line in Tracking info, naming the specs this
  one builds on (comma-separated; each identifier is either a bare number
  or a full `NN-slug` folder name — narrower than `/aide-analyze`'s
  resolver, which also takes `TODO-NN` and a JIRA key). `aide-run-spec`
  refuses to start while any named spec's `aide/<NN-slug>` branch on
  origin has commits not on the default branch — unmerged, not merely
  present — because a run cuts its branch from origin/main and would
  otherwise build on a main without that work
- The line holds back only the steps that BUILD on merged code —
  `implement`, `resolve`, `archive` (spec 122). `analyze`, `review-plan`
  and `create` write only the spec's own folder in the specs repo, so a
  whole chain of dependent specs can be analysed in parallel the moment
  it is queued. The trade-off is stated rather than hidden: a plan
  analysed before its dependency merged describes the code WITHOUT it
- Queued through the dashboard, such a step WAITS rather than fails: the
  job stays `queued` with the reason on its row and starts by itself
  when the dependency merges (the runner re-checks on every tick, and a
  merge from the page triggers one). It is cancellable like anything
  queued. A run started by hand still gets the immediate refusal —
  there is no scheduler there to park it against
- The dashboard's New-spec form can write this line too (spec 110): a
  Depends-on chip set, scoped to the chosen project's active specs, goes
  through `aide-run-spec --depends-on` to a stated value in the
  `/aide-create` prompt. The line is parsed by two independent readers —
  `aide_spec_dependencies` in `_aide-spec-lib.sh` (shell) and
  `specDependsOn` in `dashboard/src/discover.ts` (TypeScript) — kept
  deliberately unshared as a two-line duplication; a future change to
  this line's format has to update both

---

### 2-analysis

**Purpose:** Detailed technical analysis of the problem.

**Structure:**
```markdown
# [Title] - Analysis

## Table of contents

- Mapping
- Findings

---

## Mapping

**Last analyzed**: [date]

[How the analysis was performed - search terms, methods, tools used]

## Findings

**Affected files/components:**
1. `fil/path.tsx:123-145` - [description]
2. `fil/path2.tsx:67` - [description]

### Codebase analysis

[Detailed findings]

### Affected components

[Detailed description per file with specific line numbers]

### Test coverage

**Existing tests:** [list]
**Missing tests:** [gaps]
```

**Key points:**
- Focus on ANALYSIS (not solution)
- Include specific files with line numbers
- No implementation plan or solution proposals
- No complexity grade, estimate or risk analysis — those judge the
  solution we intend to build, and belong in 3-solution.md

---

### 3-solution

**Purpose:** Implementation plan with a TDD approach.

**Structure:**

````markdown
# [Title] - Solution

## Table of contents

- Scope
- Approaches
- Recommended solution
- Behavior delta
- Acceptance criteria
- Risk analysis
- Implementation plan
- Testing
- References

---

## Scope

**Files to change:** [list, from the analysis]

### Complexity

[High/Medium/Low, with the factors that drove the classification]

### Estimate

- **Manual development:** [time]
- **AI-assisted development:** [time]

---

## Approaches

### Approach 1: [Name] (recommended)

**Pros:** [list]
**Cons:** [list]
**Estimate:** [time]

---

## Recommended solution

### Before/After examples

**Before:**
```tsx
// fil/path.tsx:123
[old code]
```

**After:**
```tsx
// fil/path.tsx:123
[new code]
```

---

## Behavior delta

**Adds:** [new behavior] · **Modifies:** [before → after] · **Removes:** [behavior that goes away]

---

## Acceptance criteria

1. **Given** [precondition] **when** [action] **then** [expected outcome]

---

## Risk analysis

### [High/Medium/Low risk]

**[Risk 1]**
- **Consequence:** [description]
- **Probability:** [High/Medium/Low]
- **Mitigation:** [how to reduce]

---

## Implementation plan

### TDD approach (Red-Green-Refactor)

### Phase 1: Write tests (RED)
- [ ] Task 1
- [ ] Task 2

### Phase 2: Implement the solution (GREEN)
- [ ] Task 1
- [ ] Task 2

### Phase 3: Verify (REFACTOR)
- [ ] Run the full test suite
- [ ] Check for regressions

---

## Testing

### Unit tests
[Testing strategy]

### Manual testing
[What is NOT covered by a test, and why — a note, not a checklist]

---

## References

- 1-description.md - Problem description
- 2-analysis.md - Analysis and findings
````

**Key points:**
- Scope, complexity, estimate and risk analysis live here: they judge the
  solution we intend to build, not what the investigation found
- Approaches with pros/cons
- Before/After in SEPARATE code blocks (avoids redeclaration errors)
- Behavior delta: what the solution ADDS / MODIFIES / REMOVES relative to
  current behavior — not just which files change
- Acceptance criteria as given/when/then scenarios; the RED phase writes
  at least one failing test per criterion
- TDD approach with RED-GREEN-REFACTOR phases
- Manual testing is a NOTE, not a checklist: it names what no test
  covers and why. Nothing under it is a task, and nothing under it
  blocks archiving — 4-status has no row for it

---

### 4-status

**Purpose:** Living document that is updated along the way.

**Structure:**
```markdown
# [Title] - Status

**Total progress:** X% (Y of Z completed)
**Estimate:** [time]

## Table of contents

- Phase 1: Name
- Phase 2: Name
- Notation

---

## Phase 1: [Name]

| Task | Status | Notes |
|---------|--------|---------|
| Task 1 | ⬜ | [notes] |
| Task 2 | 🔄 | [notes] |
| Task 3 | ✅ | [notes] |

---

## Notation

| Symbol | Meaning |
|--------|-----------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |
| ❌ | Blocked |
| ⚠️ | Waiting |
```

**Key points:**
- Total progress at the top
- Organized in phases (matches 3-solution.md)
- Table format for clarity
- Updated continuously

---

## Separation of content

| Content                    | Location          |
|----------------------------|-------------------|
| Problem description        | 1-description.md  |
| Metadata                   | 1-description.md  |
| Mapping/findings           | 2-analysis.md      |
| Scope (files, estimate)    | 3-solution.md      |
| Complexity analysis        | 3-solution.md      |
| Risk analysis              | 3-solution.md      |
| Approaches                 | 3-solution.md      |
| Behavior delta             | 3-solution.md      |
| Acceptance criteria        | 3-solution.md      |
| Before/after examples      | 3-solution.md      |
| Implementation plan        | 3-solution.md      |
| Testing strategy           | 3-solution.md      |
| Progress                   | 4-status.md       |

---

## Differences JIRA vs TODO

JIRA issues and TODO plans have an **identical structure**, but differ in content:

| Aspect          | JIRA issues                   | TODO plans            |
|-----------------|-------------------------------|-----------------------|
| **Location**    | `specs/<NN>-PROJ-XXXX-slug/` | `specs/<NN>-slug/`  |
| **Source**      | JIRA API (external)           | Created manually      |
| **Description** | Copied from JIRA              | Written by the developer |
| **Metadata**    | JIRA fields (type, status, etc.)| Number, date        |

**In common:**
- 4 files: 1-description.md, 2-analysis.md, 3-solution.md, 4-status.md
- Same structure and formatting
- Same notation (⬜ 🔄 ✅ ❌ ⚠️)
- Same TDD approach in 3-solution.md

---

## Templates

AI tools create documentation directly based on the structure described in this document.

The `/aide-create` command creates the 4-file structure with the correct placeholders.
The `/aide-analyze` command fills in the analysis, solution and status.

---

## See also

- [DOCUMENTATION_STANDARD.md](./DOCUMENTATION_STANDARD.md) - General documentation rules
- [MARKDOWN_LINTING.md](./MARKDOWN_LINTING.md) - Markdown linting rules

---

# Communication rules

Rules for how the AI assistant presents text in the conversation with the user.

## Table of contents

- [Plain Norwegian — no invented or stilted words](#plain-norwegian--no-invented-or-stilted-words)
- [Answering "do we have anything outstanding?"](#answering-do-we-have-anything-outstanding)
- [Suggested text the user will copy out](#suggested-text-the-user-will-copy-out)

---

## Plain Norwegian — no invented or stilted words

Write ordinary, everyday Norwegian. This is the single most repeated piece of feedback the user has
given — across projects and across many sessions — and it keeps happening, so treat it as a hard rule
and **re-read your own reply before sending it**.

**The test:** would a Norwegian colleague say this out loud in a conversation? If not, rewrite it.

**The three failure types:**

1. **Process jargon** — "paritet", "skive", "fase", "gate/gated", "lekkasje" (say "frafall"), "trakt",
   "chrome" (about UI), "bøtte" (bucket), "røret" (pipeline), "maskiner" (say "AI-assistenter").
2. **Anglicisms with Norwegian endings** — "scopet", "trigge", "pushe" (outside the git command).
3. **Stilted words where an everyday one exists** — "setet" for "hovedstaden", "senteret", and other
   "finer" synonyms. This one sneaks in when SUMMARISING work that was explained plainly a moment
   earlier.

**One word per thing, all the way through.** Having written "hovedstad" in the explanation, write
"hovedstad" in the summary too — not a variation. The same goes for the user's own words: if he wrote
"FB reels", write "FB reels", never an abstraction over it ("kortvideo-formatet").

**Every sentence must stand alone.** No phrases that assume the reader followed your reasoning
("husets egen regel", "telleren er på plass — så tallet er ekte"). Spell references out: "regelen i
docs/X sier at …".

**Don't comment on the user's time or state** ("dette kan vente til i morgen", "med friske øyne"). He
runs his own evening.

Applies to the chat. English code comments and commit messages stay English.

---

## Answering "do we have anything outstanding?"

When the user asks "har vi noe utestående?", "utestående aksjoner?" or any variation, the answer is
a **numbered list of concrete outstanding actions — nothing else**. Number the points (1., 2., 3. …)
so the user can refer to them by number in the reply.

**Each point must be:**

- A specific action that is still to be done, described so it can be picked up without more context
- Something we have actually discussed but not prioritised, or a known bug or gap
- Followed by a proposed solution — not just the problem. Say what you would do about it.

**When the point has several possible solutions the user must choose between**, list them as
sub-bullets under the point, one per option, each with its advantages, disadvantages and
consequences. Consequences means what the choice drags along with it: what else has to change, what
it costs, what it locks in. Say which one you would pick and why.

**Letter the options a, b, c …** under the point's number, so the user can name one as "3c". Write
the letter at the start of the sub-bullet — `- **a.** Dynamiske tagger.` — and keep the lettering
restarting at `a` under every point. The user's reply may then be nothing but a reference like "ta
3c"; treat that as choosing that option and get on with it.

**Never include:**

- What has been done, what was committed, or any other status
- Whether the working tree is clean, tests are green, or the build passes
- Backlog headings without content ("see docs/SPEC.md") — write out the actual points
- Preamble, summary or closing remarks around the list
- **Missing content in the user's own data** — an exercise without an illustration, a routine
  without a description, a record with an empty field. That is the user filling in his own data,
  not work on the software. It does not belong in the action list, and it does not belong in the
  project's backlog either. Note it where the data lives (an assets README or similar) if it is
  worth writing down at all.

If there is genuinely nothing outstanding, say that in one sentence — do not fill the space with a
recap.

This rule applies to ALL projects and sessions.

---

## Suggested text the user will copy out

**Do not use markdown blockquotes (`> ` in front of each line)** when suggesting text the user will copy and paste somewhere else (Slack messages, PR comments, commit messages, emails, etc.).

**Why:** Blockquotes render as a vertical bar in the left margin of the terminal, and the `>` characters come along when copying. That makes the text unusable without manual cleanup.

**How:**

- Distinguish between text that is *your reply* (may use blockquotes/headers freely) and text that is *a suggestion for external use* (plain text, do not prefix each line with `>`).
- To visually delimit the suggested text, instead use `---` above and below, or a short lead-in like "Suggestion:" on the preceding line.
- Markdown for italics/bold/lists inside the suggestion is fine — it is only the blockquote prefix that is the problem.

**Example:**

Wrong:

```text
Suggested Slack message:

> Thanks for the review.
> We have cleaned up the code now.
```

Correct:

```text
Suggested Slack message:

---

Thanks for the review.
We have cleaned up the code now.

---
```

This rule applies to ALL projects and sessions.
