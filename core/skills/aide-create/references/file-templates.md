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
  when nothing was stated.
- **Description:** DESC + editable note
- NO criteria for done-ness here — they are part of the solution (3-solution.md)
- NO affected files or estimate here — they are commitments about the
  solution (3-solution.md)

## 2-analysis.md (placeholder - filled in by /aide-analyze)

Structure - follow the spec structure § 2-analysis:

- `# TITLE - Analysis`
- TOC with: Tracking info, Mapping, Findings
- **Tracking info:** Task=`FOLDER/`, Last analyzed=`[not analyzed yet]`,
  Repo=`[not analyzed yet]` (filled as `repo/branch @ commit`, one line per repo)
- **Mapping:** Placeholder for how the analysis was performed - search terms, methods, tools
- **Findings:** Affected files (numbered list) plus sections for codebase analysis, affected components, patterns, test coverage, API dependencies
- NOTHING that judges the solution — no grade, estimate or risks (3-solution.md)

## 3-solution.md (placeholder - filled in by /aide-analyze)

Structure - follow the spec structure § 3-solution:

- `# TITLE - Solution`
- TOC with: Tracking info, Scope, Approaches, Recommended solution, Behavior delta, Acceptance criteria, Risk analysis, Implementation plan, Testing
  (a "Plan review" section is added after Acceptance criteria by /aide-review-plan)
- **Tracking info:** Task=`FOLDER/`, Last updated=`[not prepared yet]`,
  Repo=`[not prepared yet]` (filled as `repo/branch @ commit`, one line per repo)
- **Scope:** Placeholder for files to change, complexity (level + factors), estimate (manual + AI-assisted)
- **Approaches:** Placeholder for 2 approaches with pros/cons/estimate
- **Recommended solution:** Placeholder with before/after examples (SEPARATE code blocks)
- **Behavior delta:** What the solution Adds / Modifies / Removes in behavior, relative to today
- **Acceptance criteria:** Testable given/when/then scenarios; the RED phase writes one failing test per criterion
- **Risk analysis:** Placeholder for risks with consequence/probability/mitigation
- **Implementation plan:** TDD Red-Green-Refactor with 4 phases and checkbox lists
- **Testing:** Sections for unit, integration, e2e, manual testing

## 4-status.md (placeholder - filled in by /aide-analyze)

Structure - follow the spec structure § 4-status:

- `# TITLE - Status`
- Total progress: `0% (0 of X completed)`, Estimate: `[X hours/days]`
- TOC with: Tracking info, Phase 1-4, Notation
- **Tracking info:** Task=`FOLDER/`, Last updated=`[not started]`
- **Phase 1-4:** RED/GREEN/GREEN/REFACTOR phases with tables (Task|Status|Notes)
- **Notation:** Not started, In progress, Completed, Blocked, Waiting
