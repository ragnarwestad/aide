---
paths:
  - "**/1-description.md"
  - "**/2-analysis.md"
  - "**/3-solution.md"
  - "**/4-status.md"
---

# Spec structure

## Table of contents

- [Overview](#overview)
- [File structure](#file-structure)
  - [1-description](#1-description)
    - [Acceptance criteria in EARS](#acceptance-criteria-in-ears)
  - [2-analysis](#2-analysis)
  - [3-solution](#3-solution)
  - [4-status](#4-status)
- [Separation of content](#separation-of-content)
- [Templates](#templates)

---

## Overview

Four files per spec, in `specs/<NN>-slug/` (an issue key in the title is
part of the slug):

1. **1-description.md** — the problem as reported
2. **2-analysis.md** — what the investigation found
3. **3-solution.md** — the solution and its plan, test first
4. **4-status.md** — progress, updated as the work goes

Each file is created from its template, and its headings are the
structure to fill in. A fifth file, `test-run.json`, is written by
`aide-record-test-run` and read by `aide-archive-spec`; no model writes
or reads it.

The details a step needs only in some runs — the Tracking info lines,
approach marks, the lines the runner writes, the acceptance rows in a
new round — are in the aide-analyze skill's `references/spec-files.md`.

---

## File structure

### 1-description

```markdown
# [Title] - Description

## Tracking info

- **Task:** `NN-slug/`
- **Created:** `YYYY-MM-DD`

---

## Description

[The description as given; the user may add to it by hand]

## Acceptance criteria (optional)

- **AC-1:** The system SHALL ...
- **AC-2:** WHEN ..., the system SHALL ...

## Out of scope

- [what the change must not do or touch]
```

- The description is written as given, never rewritten. It holds no
  code, no files to change and no estimate: those belong in the solution
- Acceptance criteria are optional: a flat bullet list, the id in bold
  (`**AC-n:**`), one sentence per id in one of the five EARS patterns
  below. Ids are additive: never renumbered or reused
- An `## Out of scope` section is optional, under exactly that heading:
  a flat list of what the change must not do or touch. It is the
  author's own; the plan review and the review after implement hold the
  change to it
- Tracking info may carry `Depends on:`, `Acceptance criteria checks:`
  and `Let me choose the approach:` lines; `references/spec-files.md`
  says what each does

#### Acceptance criteria in EARS

Each criterion is one sentence in one of the five EARS patterns (Easy
Approach to Requirements Syntax). The condition comes first, in its own
clause, so a reader knows when the criterion holds before reading what it
asks for. A criterion with no condition is the always pattern; a condition
written after SHALL follows none of the five.

- **Always:** `The <system> SHALL <response>` — "The status file SHALL
  carry one row per AC-n id."
- **Event:** `WHEN <trigger>, the <system> SHALL <response>` — "WHEN a step
  ends, the runner SHALL write its result into the status file."
- **State:** `WHILE <state>, the <system> SHALL <response>` — "WHILE a job
  runs on a spec, the specs list SHALL lock that spec's Run button."
- **Unwanted behaviour:**
  `IF <condition>, THEN the <system> SHALL <response>` — "IF origin
  refuses the push, THEN the runner SHALL keep the commit on the spec's
  branch."
- **Optional feature:** `WHERE <feature>, the <system> SHALL <response>` —
  "WHERE a project has a wiki, /aide-analyze SHALL read it before the code."

`<system>` is whatever the criterion is about — a script, a skill, a page.
The keywords are written in capitals, as SHALL is.

---

### 2-analysis

What the investigation found: how it was done, the affected files with
`file:line`, the code, the test coverage. No solution, complexity grade,
estimate or risk: those judge the solution, and belong in 3-solution.md.

---

### 3-solution

Scope (files, complexity, estimate), Approaches with the recommended one
under its own `### Recommended: Approach X` heading, the recommended
solution with its Parts, Behavior delta, Acceptance criteria as
given/when/then scenarios, Risk analysis, the implementation plan
(RED, GREEN, VERIFY) and Testing.

- The recommended approach IS the spec: every section below it describes
  that approach, and `/aide-implement` builds the plan it finds
- Each approach is a bold lead, `**Approach A: [Name] (recommended).**`,
  never a heading; on a spec whose `Let me choose the approach:` line
  says `yes`, every lead carries one of three marks
  (`references/spec-files.md`)
- `### Where the tests sit` names, one line per place, the public
  interface where the behaviour is observed, its test file and the rules
  tested there; `/aide-implement` writes its tests there
- Manual testing is a note, not a checklist: what no test covers, and why

---

### 4-status

Phase tables matching 3-solution.md's plan, one row per task, the Status
cell a symbol from the file's own Notation (`⬜`, `🔄`, `✅`).

- **The runner writes these lines; never edit them:** `Workflow steps
  completed:`, `Total progress:`, and each phase's `Repo`/`Model`/
  `Result`/`Time spent`/`Cost` record in that phase's own file
- **No skill ever ticks a row under `## Acceptance criteria`**, and none
  writes `Not verified` or `Failed`: those are the user's judgment. The
  section has one row per `AC-n`, and archiving waits until every row is
  ticked. A new round on a held-back or reopened spec has its own rules
  (`references/spec-files.md`)

---

## Separation of content

| Content                                                        | Location         |
|----------------------------------------------------------------|------------------|
| Problem description                                            | 1-description.md |
| Acceptance criteria — source (AC-n, optional)                  | 1-description.md |
| Out of scope — what the change must not do or touch (optional) | 1-description.md |
| Metadata                                                       | 1-description.md |
| Mapping/findings                                               | 2-analysis.md    |
| Scope (files, estimate)                                        | 3-solution.md    |
| Complexity analysis                                            | 3-solution.md    |
| Risk analysis                                                  | 3-solution.md    |
| Approaches                                                     | 3-solution.md    |
| Behavior delta                                                 | 3-solution.md    |
| Acceptance criteria — testable scenarios                       | 3-solution.md    |
| Before/after examples                                          | 3-solution.md    |
| Implementation plan                                            | 3-solution.md    |
| Testing strategy                                               | 3-solution.md    |
| Progress                                                       | 4-status.md      |
| Acceptance criteria — tick checklist (AC-tagged, optional)     | 4-status.md      |

---

## Templates

The `/aide-create` command creates the four files from their templates;
`/aide-analyze` fills in the analysis, the solution and the status.

**Spec files are always produced by invoking the actual `/aide-*` skill
for that step — never by hand-writing or reimplementing the pattern
directly with Read/Write/Bash, even when the exact structure is already
known from a previous invocation in the same session.** A spec created
this way carries none of the commits, review or convention the skill
provides, and looks identical to one that did.

Where `aide-install-spec-hook` has been run, a commit touching a spec's
files is rejected unless its message follows the
`Run /aide-<step> for <spec-folder>` convention; a hand-edit to an
existing `1-description.md` is the one exception.
