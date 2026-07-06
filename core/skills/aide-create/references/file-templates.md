# File templates for task documentation

Placeholders: TITLE=title, FOLDER=NN-slug, DATE=today's date, DESC=description

## 0-README.md

```markdown
# Documentation

**Table of contents:**

1. [Description](1-description.md) - Tracking info, goal, scope, acceptance criteria
2. [Analysis](2-analysis.md) - Findings, complexity, risk analysis
3. [Solution](3-solution.md) - Implementation plan with TDD
4. [Status](4-status.md) - Progress tracking
```

## 1-description.md (fill in all fields)

Structure - follow the report structure § 1-description:

- `# TITLE - Description`
- TOC with: Tracking info, Description, Scope, Acceptance criteria
- **Tracking info:** Task=`FOLDER/`, Created=`DATE`
- **Description:** DESC + editable note
- **Scope:** `[filled in by /aide-analyze]` for affected files, estimate, systems
- **Acceptance criteria:** `[Filled in by /aide-analyze based on the codebase analysis]`

## 2-analysis.md (placeholder - filled in by /aide-analyze)

Structure - follow the report structure § 2-analysis:

- `# TITLE - Analysis`
- TOC with: Tracking info, Scope, Complexity, Findings, Risk analysis
- **Tracking info:** Task=`FOLDER/`, Last analyzed=`[not analyzed yet]`
- **Scope:** Placeholder for number of files, mapping, affected files (numbered list)
- **Complexity:** Placeholder for level, factors, estimate (manual + AI-assisted)
- **Findings:** Sections for codebase analysis, affected components, patterns, test coverage, API dependencies
- **Risk analysis:** Placeholder for risks with consequence/probability/mitigation

## 3-solution.md (placeholder - filled in by /aide-analyze)

Structure - follow the report structure § 3-solution:

- `# TITLE - Solution`
- TOC with: Tracking info, Approaches, Recommended solution, Implementation plan, Testing
- **Tracking info:** Task=`FOLDER/`, Last updated=`[not prepared yet]`
- **Approaches:** Placeholder for 2 approaches with pros/cons/estimate
- **Recommended solution:** Placeholder with before/after examples (SEPARATE code blocks)
- **Implementation plan:** TDD Red-Green-Refactor with 4 phases and checkbox lists
- **Testing:** Sections for unit, integration, e2e, manual testing

## 4-status.md (placeholder - filled in by /aide-analyze)

Structure - follow the report structure § 4-status:

- `# TITLE - Status`
- Total progress: `0% (0 of X completed)`, Estimate: `[X hours/days]`
- TOC with: Tracking info, Phase 1-4, Notation
- **Tracking info:** Task=`FOLDER/`, Last updated=`[not started]`
- **Phase 1-4:** RED/GREEN/GREEN/REFACTOR phases with tables (Task|Status|Notes)
- **Notation:** Not started, In progress, Completed, Blocked, Waiting
