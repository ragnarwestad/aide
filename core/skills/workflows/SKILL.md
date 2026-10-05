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
- [The spec workflows](#the-spec-workflows)
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

**Documentation:** Short and concise (< 200 lines total)
**Estimate:** Minutes to hours (< 2 hours)

---

### MEDIUM complexity

**Analysis scope:**
- Find files related to the component/module
- Find related tests and usage sites, and stop there

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

---

## Branch strategy

**Before starting analysis or implementation:**

A change may span **several repositories** (e.g. my-app and my-api).
Check out the same branch in each of them, or the analysis and the
implementation read the wrong code.

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

Which repositories and branches a phase worked against is recorded as
`Repo` lines in Tracking info; the spec-structure skill has the format.

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

## See also

- The spec-structure skill - 4-file structure for specs