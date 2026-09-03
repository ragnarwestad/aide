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

`/aide-implement`'s REFACTOR phase adds a fifth, non-markdown file next
to these four: `test-run.json`, written by `core/scripts/aide-record-test-run`
and read by `core/scripts/aide-archive-spec`'s test-record gate — never
written or read by a model. `aide-archive-spec`'s move step already
`git mv`s the whole folder, so it needs no special handling of its own.

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

---

## Requirements (optional)

- **REQ-1:** The system SHALL ...
- **REQ-2:** The system SHALL ...

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
  `implement`, `archive`. `analyze` and `create` write only the spec's
  own folder, so a whole chain of dependent specs can be analysed in
  parallel before it merges — the tradeoff being that the plan then
  describes the code WITHOUT it
- Queued through the dashboard, such a step WAITS rather than fails: it
  stays `queued`, starts itself once the dependency merges, and is
  cancellable. Run by hand, it still refuses immediately — there is no
  scheduler there to park it against
- Requirements is OPTIONAL: a flat bullet list, id in bold
  (`**REQ-n:**`), one SHALL sentence per id — no table, no nested
  lists, so both the definition and any reference stay grep-able with a
  plain regex
- REQ-n ids are additive only: once written, never renumbered or
  reused, even if later dropped — same philosophy as 4-status.md's
  `Workflow steps completed` line
- JIRA mode never adds a Requirements section — the Problem text is
  external and verbatim. TODO mode authors it from scratch alongside
  the Problem text (see the aide-create skill)
- A description already carrying a matching `## Requirements` section
  is passed through unchanged — no rewriting, no second section
  appended. Only a description with no such section gets one authored
  from scratch. `aide-create-spec` refuses to create a spec whose
  description contains a `REQ-n:` bullet that does not match the bold
  format exactly
- `/aide-analyze` never retrofits a Requirements section into an
  existing `1-description.md` on its own initiative — only original
  authoring (via `/aide-create`) adds one

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
- Scope, complexity, estimate and risk analysis live here: they judge
  the solution, not what the investigation found
- Approaches with pros/cons. The RECOMMENDED one IS the spec — every
  section below it describes that approach and no other, and
  `/aide-implement` builds the plan it finds. Wanting a different one
  means saying so in `1-description.md` and analysing again
  (`/aide-reset`, then `/aide-analyze`)
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
- **Workflow steps completed:** create, analyze   <!-- written by aide-run-spec -->
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

One line in Tracking info, saying how far a spec has got through the
workflow:

```markdown
- **Workflow steps completed:** create, analyze
```

The allowed values, in workflow order, are `create`, `analyze`, `implement`
and `archive`. A missing line means nothing is known to have completed;
an unknown value is ignored.

**Do not edit this line. It is written by `aide-run-spec`, from the
spec's own commits** — every step the runner finishes leaves a commit
whose subject names the step and how it ended, and the line is derived
from those commits at the end of every run, so the file agrees with git
rather than with whoever remembered to update it. A step run
interactively counts once committed under the same subject — the four
step skills offer exactly that commit, and ask first.

**The line is added to, never subtracted from.** A step it already
names stays even when no commit currently corroborates it — a copied
claim (a spec's four files copied from a sibling) stands the same way,
since the scan cannot tell it from a real one. `aide-reopen` and
`aide-reset` are the only places a step comes off, by regenerating the
file without the line at all.

The dashboard reads the same commits, live, to mark a spec's phases
done — a `4-status.md` that disagrees with them is said out loud on the
row rather than believed.

#### Total progress

One line, near the top of the file, saying how many of the file's own
Phase-table rows are done:

```markdown
- **Total progress:** 50% (2 of 4 completed)
```

**Do not edit this line by hand. `aide-run-spec` recomputes it** at the
end of every step from the file's own `## Phase`/`## Fase` rows — a
well-formed three-column row counts as one task, done when its Status
cell reads `✅` or `Completed`; header rows, separators and free
commentary are skipped. A file whose Phase tables have no rows yet
(fresh from the template) is left alone: there is nothing yet to
derive.

#### Phase outcome record

Each of the four phases writes its own outcome into the Tracking info
of the file that is ITS OWN artifact — never into 4-status.md on
another phase's behalf:

| Phase | Own file | Date field enriched |
|---|---|---|
| create | 1-description.md | `Created:` |
| analyze | 2-analysis.md | `Last analyzed:` |
| implement | 3-solution.md | `Last updated:` |
| archive | 4-status.md | `Last updated:` |

The record, beside the file's own existing date field — never a new
one, the date already exists, only the time of day is new
(`` `YYYY-MM-DD HH:MM UTC` ``):

```markdown
- **Repo:** `repo-name/branch @ sha`
- **Model:** claude claude-sonnet-5
- **Result:** completed
- **Time spent:** 4m12s
- **Cost:** $0.1234
```

`Repo` is one line per repo root; it is absent for `create`, since
nothing has been analyzed against yet. `Result` is `completed`, or
`stopped (<reason>)` with a one-line error summary. `Cost` is absent
for a tool that reports no cost (codex) — absence means unknown, never
zero.

**Do not edit these lines. `aide-run-spec` writes them**, never from a
model's own account of itself. Each run OVERWRITES its phase's own
block with the newest outcome — unlike `Workflow steps completed`,
nothing here is added to across runs.

**An absent `Model` line does not prove the phase ran without a
model** — only that no commit could be attributed to it, the ordinary
case for a file a person wrote and committed by hand under their own
message.

Specs archived before this record existed may still carry the older,
centralized `Model (create):`/`Model (analyze):`/`Model (implement):`
lines in their `4-status.md` — left exactly as they are, not migrated.

#### Acceptance criteria (optional)

When `1-description.md` has a `## Requirements` section, `/aide-analyze`
adds one more section to `4-status.md`, after the last implementation
phase and before `## Notation`, with exactly one row per `REQ-n` id
from `1-description.md`, in ascending id order, carrying that
requirement's own SHALL text — never a scenario from `3-solution.md`'s
Acceptance criteria, which a person cannot judge and which can repeat
one id across several scenarios:

```markdown
## Acceptance criteria

| Task | Status | Notes |
|------|--------|-------|
| REQ-1: <requirement text, verbatim from 1-description.md> | ⬜ | |
| REQ-2: <requirement text, verbatim from 1-description.md> | ⬜ | |
```

No Requirements section: `4-status.md` looks exactly as it does today —
no such section, no change to archiving.

**These rows start unticked, and no skill ever ticks one.** Unlike the
RED/GREEN/REFACTOR rows above, an acceptance-criteria row names a
judgment only the person the spec is for can make — ticking it is the
same one-click Overview-tab action any other recognized row offers.
Placing the section after the last implementation phase means it only
becomes tickable once every earlier phase's own rows are done.

**`aide-archive-spec` refuses to archive while any of these rows is
still unticked**, with `terminalReason: "acceptance-criteria-unticked"`
— the one place a "must be ticked" gate exists in this file, scoped to
this section alone. A spec with no such section, or every row ticked,
archives exactly as it did before this section existed.

---

## Separation of content

| Content                 | Location         |
|-------------------------|------------------|
| Problem description     | 1-description.md |
| Requirements (REQ-n, optional) | 1-description.md |
| Metadata                | 1-description.md |
| Mapping/findings        | 2-analysis.md    |
| Scope (files, estimate) | 3-solution.md    |
| Complexity analysis     | 3-solution.md    |
| Risk analysis           | 3-solution.md    |
| Approaches              | 3-solution.md    |
| Behavior delta          | 3-solution.md    |
| Acceptance criteria     | 3-solution.md    |
| Before/after examples   | 3-solution.md    |
| Implementation plan     | 3-solution.md    |
| Testing strategy        | 3-solution.md    |
| Progress                | 4-status.md      |
| Acceptance-criteria check rows (REQ-tagged, optional) | 4-status.md |

---

## Differences JIRA vs TODO

JIRA issues and TODO plans have an **identical structure**, but differ in content:

| Aspect          | JIRA issues                      | TODO plans               |
|-----------------|----------------------------------|--------------------------|
| **Location**    | `specs/<NN>-PROJ-XXXX-slug/`     | `specs/<NN>-slug/`       |
| **Source**      | JIRA API (external)              | Created manually         |
| **Description** | Copied from JIRA                 | Written by the developer |
| **Metadata**    | JIRA fields (type, status, etc.) | Number, date             |

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

**Spec files are always produced by invoking the actual `/aide-*` skill
for that step — never by hand-writing or reimplementing the pattern
directly with Read/Write/Bash, even when the exact structure is already
known from a previous invocation in the same session.** A spec created
this way carries none of the commits, review or convention the skill
provides, and looks identical to one that did.

---

## See also

- The documentation skill - General documentation rules
- The markdown-linting skill - Markdown linting rules
