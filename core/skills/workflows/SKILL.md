---
name: workflows
description: >-
  The workflow for AI-assisted development: complexity detection
  (LOW/MEDIUM/HIGH), problem-type routing, branch strategy across
  repositories, and the create - analyze - implement - archive flow for
  a spec.
  Use when: starting work on a spec, deciding how much
  analysis a task needs, planning a change that spans several projects,
  checking which branch belongs where.
  Do NOT use for: the spec files' own layout (use the spec-structure
  skill), how to run tests (that is the testing rule).
effort: medium
---

# Workflows for AI-assisted development

## Table of contents

- [Complexity detection](#complexity-detection)
  - [LOW complexity (Quick Fix)](#low-complexity-quick-fix)
  - [MEDIUM complexity](#medium-complexity)
  - [HIGH complexity](#high-complexity)
- [Problem type routing (Quick Reference)](#problem-type-routing-quick-reference)
- [Branch strategy](#branch-strategy)
  - [Why this matters](#why-this-matters)
  - [Recommended procedure](#recommended-procedure)
  - [Tracking info in documentation](#tracking-info-in-documentation)
- [The spec workflows](#the-spec-workflows)
- [Summary](#summary)
- [See also](#see-also)

---

## Complexity detection

**Principle:** Match the scope of the documentation to the complexity of the task.

**Grading:** the grade is set once the code has been read, by the risk of
the change. The criteria and two worked examples are in `aide-analyze`'s
`references/complexity-and-analysis.md`, and nowhere else. Each level
below says what its grade means for the analysis and for the documents.

### LOW complexity (Quick Fix)

**Analysis scope:**
- Read ONLY the mentioned file
- Do NOT search the entire codebase

**Documentation:** Short and concise (< 200 lines total)
**Estimate:** Minutes to hours (< 2 hours)

---

### MEDIUM complexity

**Analysis scope:**
- Find files related to the component/module
- Find related tests and usage sites
- Do NOT search wider than necessary

**Documentation:** Moderate detail (100-300 lines total)
**Estimate:** Hours to days (2-16 hours)

---

### HIGH complexity

**Analysis scope:**
- Search the codebase broadly for patterns
- Categorize files by complexity
- Analyze API impact (frontend - backend)
- Identify edge cases and risks

**Documentation:** Comprehensive analysis (300-800 lines total)
**Estimate:** Days to weeks (1-10 days)

---

## Problem type routing (Quick Reference)

Start every problem type from the project's OWN documentation when it has
any (a coding standard, an architecture overview, API docs) — check the
README and the docs folder first. A project without such docs is normal:
the code itself is the source, so search it instead of hunting for
documents.

| Problem type          | Workflow                                          |
|-----------------------|---------------------------------------------------|
| **Frontend UI bug**   | Reproduce - Identify component - Check API - TDD  |
| **Backend API error** | Identify endpoint - Check ripple effects - TDD    |
| **Cross-project**     | Backend first - Test - Frontend - Full stack test |
| **Refactoring**       | Secure tests - Refactor - Verify green tests      |
| **Test generation**   | Read code - Identify edge cases - Write tests     |
| **New functionality** | Read the spec - Analyze scope - TDD               |
| **Database change**   | Identify ripple effects - Migration script - Test |
| **Performance**       | Profile - Find root cause - Benchmark - Optimize  |

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

- **Last analyzed:** `2025-11-07`
- **Repo:** `my-app/feature/PROJ-7637 @ abc123de`
- **Repo:** `my-api/feature/PROJ-7637 @ def456ab`
```

The `Repo` lines belong in BOTH `2-analysis.md` and `3-solution.md` —
the solution is written against a state of the code, and that state must
be recorded where the solution lives.

---

## The spec workflows

The phases are written out in full in
[references/spec-workflows.md](./references/spec-workflows.md):

```text
(Explore) - Create - Analyze - Implement - Archive
```

**Explore is optional and has no stakes:** `/aide-explore` thinks the
problem through with the user first — no files, no spec. Use it when the
idea or scope is not ready for `/aide-create` yet. **Review runs at
every complexity:** `/aide-analyze` attacks
`3-solution.md` from three reviewer perspectives before the first test is
written, as its own last step.

The rest of the detail lives beside this file:

| Reference                                                                    | What it covers                                                                                |
|------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| [references/spec-workflows.md](./references/spec-workflows.md)               | Every phase of the spec workflow: what each one does, what it produces, when to re-run it     |
| [references/api-impact.md](./references/api-impact.md)                       | Assessing API impact, and the order to implement a change that spans several projects         |
| [references/workflow-optimization.md](./references/workflow-optimization.md) | Context management, course correction, Explore - Plan - Code, checklists for large migrations |

---

## Summary

**Three key principles:**
1. **Grade complexity** once the code is read, and match the documentation to it
2. Follow the **linear flow**: Create - Analyze - Implement - Archive
3. Always assess **API impact** (use the mapping)

**Best practices:**
1. Use `/clear` between independent tasks
2. Follow **Explore - Plan - Code - Commit**
3. Iterate toward **clear goals** (tests, screenshots, specifications)
4. Use **checklists** for complex tasks

---

## See also

- The spec-structure skill - 4-file structure for specs