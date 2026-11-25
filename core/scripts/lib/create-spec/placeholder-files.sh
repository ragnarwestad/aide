# shellcheck shell=bash
# Sourced by _aide-spec-lib.sh.
#
# The three files a work round fills in — 2-analysis.md, 3-solution.md
# and 4-status.md — written fresh from the templates in
# core/scripts/lib/steps/aide-create/references/file-templates.md. One writer for
# create (a new spec) and aide-reset-spec (a spec whose round must not count):
# 0-README.md and 1-description.md are never touched here.
# Usage: aide_write_placeholder_files <dest-dir> <title> <folder>
aide_write_placeholder_files() {
  aide_write_analysis_placeholder "$@"
  aide_write_solution_placeholder "$@"
  aide_write_status_placeholder "$@"
}

aide_write_analysis_placeholder() {
  local dest="$1" title="$2" folder="$3"
  cat > "$dest/2-analysis.md" <<AIDE_EOF
# ${title} - Analysis

## Table of contents

- [Tracking info](#tracking-info)
- [Mapping](#mapping)
- [Findings](#findings)

---

## Tracking info

- **Task:** \`${folder}/\`
- **Last analyzed:** \`[not analyzed yet]\`

---

## Mapping

*(Filled in by /aide-analyze: search terms, methods, tools used to locate affected code.)*

---

## Findings

### Affected files

*(Filled in by /aide-analyze.)*

### Files to change

*(Filled in by /aide-analyze.)*

### Codebase analysis

*(Filled in by /aide-analyze.)*

### Affected components

*(Filled in by /aide-analyze.)*

### Patterns

*(Filled in by /aide-analyze.)*

### Test coverage

*(Filled in by /aide-analyze.)*

### API dependencies

*(Filled in by /aide-analyze.)*
AIDE_EOF
}

aide_write_solution_placeholder() {
  local dest="$1" title="$2" folder="$3"
  cat > "$dest/3-solution.md" <<AIDE_EOF
# ${title} - Solution

## Table of contents

- [Tracking info](#tracking-info)
- [Scope](#scope)
- [Approaches](#approaches)
- [Recommended solution](#recommended-solution)
- [Behavior delta](#behavior-delta)
- [Acceptance criteria](#acceptance-criteria)
- [Risk analysis](#risk-analysis)
- [Implementation plan](#implementation-plan)
- [Testing](#testing)

---

## Tracking info

- **Task:** \`${folder}/\`
- **Last updated:** \`[not prepared yet]\`

---

## Scope

*(Filled in by /aide-analyze: files to change, complexity level and
factors, estimate.)*

---

## Approaches

*(Filled in by /aide-analyze: at least 2 approaches with pros/cons/estimate.)*

---

## Recommended solution

*(Filled in by /aide-analyze: before/after examples, in separate code blocks.)*

---
AIDE_EOF
  aide_append_solution_sections "$dest"
}

# The sections of 3-solution.md from Behavior delta on, which name
# neither the title nor the folder.
aide_append_solution_sections() {
  local dest="$1"
  cat >> "$dest/3-solution.md" <<'AIDE_EOF'

## Behavior delta

*(Filled in by /aide-analyze: what the solution adds, modifies and removes.)*

---

## Acceptance criteria

*(Filled in by /aide-analyze: testable given/when/then scenarios.)*

---

## Risk analysis

*(Filled in by /aide-analyze: risks with consequence/probability/mitigation.)*

---

## Implementation plan

*(Filled in by /aide-analyze: TDD Red-Green-Verify, 4 phases.)*

---

## Testing

*(Filled in by /aide-analyze: where the tests sit, unit, integration, e2e, and a manual testing note.)*
AIDE_EOF
}

aide_write_status_placeholder() {
  local dest="$1" title="$2" folder="$3"
  cat > "$dest/4-status.md" <<AIDE_EOF
# ${title} - Status

Total progress: 0% (0 of X completed)
Estimate: [X hours/days]

## Table of contents

1. [Tracking info](#tracking-info)
2. [Phase 1: RED](#phase-1-red)
3. [Phase 2: GREEN](#phase-2-green)
4. [Phase 3: GREEN](#phase-3-green)
5. [Phase 4: VERIFY](#phase-4-verify)
6. [Notation](#notation)

## Tracking info

- **Task:** \`${folder}/\`
- **Last updated:** \`[not started]\`

## Phase 1: RED

| Task | Status | Notes |
|------|--------|-------|

## Phase 2: GREEN

| Task | Status | Notes |
|------|--------|-------|

## Phase 3: GREEN

| Task | Status | Notes |
|------|--------|-------|

## Phase 4: VERIFY

| Task | Status | Notes |
|------|--------|-------|

## Notation

- Not started
- In progress
- Completed
- Blocked
- Waiting
AIDE_EOF
}
