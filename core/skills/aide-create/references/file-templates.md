# File templates for task documentation

Placeholders: TITLE=title, FOLDER=NN-slug, DATE=today's date, DESC=description

## 0-README.md

```markdown
# Documentation

## Table of contents

1. [Description](1-description.md) - Tracking info and the problem
2. [Analysis](2-analysis.md) - Mapping and findings
3. [Solution](3-solution.md) - Scope, plan, criteria and risk
4. [Status](4-status.md) - Progress tracking
```

## 1-description.md (fill in all fields)

Structure - follow the spec structure § 1-description:

- `# TITLE - Description`
- TOC with: Tracking info, Description
- **Tracking info:** Task=`FOLDER/`, Created=`DATE`, and — only when the
  prompt states one — Depends on=the stated value, one backticked
  identifier per comma-separated entry, on the line after `Created`
  (`- **Depends on:** ` + "`105`, `92-a-spec-can-depend`"). No line at all
  when nothing was stated. Then, by default (see this skill's own
  "Acceptance" paragraph), a `- **Acceptance:** not required` line —
  omitted only when the person creating the spec has said they want
  acceptance ticking required. Nothing about a phase outcome record either —
  the template names none of it, and this file has two writers for it
  now: `aide-run-spec` writes `Model`/`Result`/`Time spent`/`Cost` (no
  `Repo` — nothing has been analyzed against yet) into this file's own
  Tracking info once a headless `create` has actually run, plus a time
  of day onto `Created:`; `aide-create-spec --stamp-outcome`, called from
  this skill's own Step 5, writes `Model` (optional) and `Time spent`
  (always) for an interactive run instead — same fields, same
  absence-not-guess rule for `Model`, no `Repo`/`Result`/`Cost` either
  way
- **Description:** DESC + editable note — TODO mode's DESC may include an
  optional `## Acceptance criteria` section with AC-n SHALL statements,
  per aide-create's own Step 4 (never for JIRA, where Problem is
  external/verbatim)
- NO criteria for done-ness here — they are part of the solution (3-solution.md)
- NO affected files or estimate here — they are commitments about the
  solution (3-solution.md)

## 2-analysis.md (placeholder - filled in by /aide-analyze)

Structure - follow the spec structure § 2-analysis:

- `# TITLE - Analysis`
- TOC with: Tracking info, Mapping, Findings
- **Tracking info:** Task=`FOLDER/`, Last analyzed=`[not analyzed yet]` —
  and nothing about a phase outcome record: `aide-run-spec` writes
  `Repo`/`Model`/`Result`/`Time spent`/`Cost` into this file's own
  Tracking info once `analyze` has actually run, plus a time of day onto
  `Last analyzed:`
- **Mapping:** Placeholder for how the analysis was performed - search terms, methods, tools
- **Findings:** Affected files (numbered list) plus sections for codebase analysis, affected components, patterns, test coverage, API dependencies
- NOTHING that judges the solution — no grade, estimate or risks (3-solution.md)

## 3-solution.md (placeholder - filled in by /aide-analyze)

Structure - follow the spec structure § 3-solution:

- `# TITLE - Solution`
- TOC with: Tracking info, Scope, Approaches, Recommended solution, Behavior delta, Acceptance criteria, Risk analysis, Implementation plan, Testing
  (a "Plan review" section is added after Acceptance criteria by /aide-analyze's review step)
- **Tracking info:** Task=`FOLDER/`, Last updated=`[not prepared yet]` —
  and nothing about a phase outcome record: `aide-run-spec` writes
  `Repo`/`Model`/`Result`/`Time spent`/`Cost` into this file's own
  Tracking info once `implement` has actually run, plus a time of day
  onto `Last updated:`
- **Scope:** Placeholder for files to change, complexity (level + factors), estimate (manual + AI-assisted)
- **Approaches:** Placeholder for 2 approaches with pros/cons/estimate
- **Recommended solution:** Placeholder with before/after examples (SEPARATE code blocks)
- **Behavior delta:** What the solution Adds / Modifies / Removes in behavior, relative to today
- **Acceptance criteria:** Testable given/when/then scenarios; the RED phase writes one failing test per criterion
- **Risk analysis:** Placeholder for risks with consequence/probability/mitigation
- **Implementation plan:** TDD Red-Green-Refactor with 4 phases and checkbox lists
- **Testing:** Sections for unit, integration and e2e tests, plus a Manual testing note (what no test covers and why — a note, not a checklist)

## 4-status.md (placeholder - filled in by /aide-analyze)

Structure - follow the spec structure § 4-status:

- `# TITLE - Status`
- Total progress: `0% (0 of X completed)`, Estimate: `[X hours/days]`
- TOC with: Tracking info, Phase 1-4, Notation
- **Tracking info:** Task=`FOLDER/`, Last updated=`[not started]` — and
  nothing about which steps the spec has had, nor about a phase outcome
  record for `archive` itself. Both the line naming the completed steps
  and the `Repo`/`Model`/`Result`/`Time spent`/`Cost` block beside it are
  written by `aide-run-spec` from the spec's own commits and process
  data (see the spec structure § 4-status), so a new spec starts without
  any of them
- **Phase 1-4:** RED/GREEN/GREEN/REFACTOR phases with tables (Task|Status|Notes)
- **Notation:** Not started, In progress, Completed, Blocked, Waiting
