---
paths:
  - "**/1-description.md"
  - "**/2-analysis.md"
  - "**/3-solution.md"
  - "**/4-status.md"
---

# Spec structure for JIRA and TODO

## Table of contents

- [Overview](#overview)
- [File structure](#file-structure)
  - [1-description](#1-description)
  - [2-analysis](#2-analysis)
  - [3-solution](#3-solution)
  - [4-status](#4-status)
    - [Workflow steps completed](#workflow-steps-completed)
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

## Tracking info

- **Task:** `NN-slug/`
- **Workflow steps completed:** create, analyze
- **Total progress:** X% (Y of Z completed)
- **Estimate:** [time]
- **Last updated:** `YYYY-MM-DD`

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

#### Workflow steps completed

One line in Tracking info, and the ONLY record of how far a spec has
got through the workflow:

```markdown
- **Workflow steps completed:** create, analyze, review-plan
```

The allowed values, in workflow order, are `create`, `analyze`,
`review-plan`, `implement` and `archive`. A missing line means nothing
is known to have completed; an unknown value is ignored.

**Each step writes its own value, and only once it has succeeded.**
`/aide-create` starts the line at `create`; `/aide-analyze`,
`/aide-review-plan`, `/aide-implement` and `/aide-archive` each add
their own, keeping the values already there. A step that failed, was
declined, was held back or had nothing it could do writes nothing —
the line says what HAPPENED, never what was attempted. Re-running a
step leaves one occurrence, not two.

The dashboard reads this line to mark a spec's phases done and to
pre-tick the step to run next. It reads nothing else for that: the
progress percentage below says how far the TDD phases inside
`implement` have got, which is a different question from whether
`implement` ran at all.

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
