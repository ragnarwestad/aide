# Requirements tracing: REQ-n through the analysis

When 1-description.md has a `## Requirements` section, /aide-analyze
threads its REQ-n ids through the rest of the spec. No section present:
every step below is unchanged from today's plain-text behavior.

## Step 1 (read the description)

Extract every REQ-n id (matched by `^- \*\*REQ-\d+:\*\*`). Keep the
list for Steps 5-7.

## Step 5 (2-analysis.md)

Prefix a finding with the REQ-id(s) it supports:
`REQ-n → file:line — <reasoning>`. A finding tied to no particular
requirement stays unprefixed free text, exactly as today.

## Step 6 (3-solution.md, Acceptance criteria)

Each criterion opens with the REQ-id it covers:
`1. **REQ-1** — Given ... when ... then ...`. Several criteria may
share one id; every id from Step 1 must be covered by at least one.
No Requirements section: criteria stay in today's plain form.

## Step 7 (Review the plan)

New must-fix check, folded into the Coherence reviewer: every REQ-id
from Step 1 must appear in at least one Acceptance criterion. A missing
id is a must-fix. A plain-text check the reviewing session performs
itself, reading the two files — no dashboard, no pytest.

## Step 8 (4-status.md, Acceptance criteria section)

Add a `## Acceptance criteria` section to `4-status.md`, placed after
the last implementation phase (e.g. `## Phase 4: REFACTOR`) and before
`## Notation`, with one row per REQ-tagged acceptance criterion from
`3-solution.md`, starting unticked:

```markdown
## Acceptance criteria

| Task | Status | Notes |
|------|--------|-------|
| REQ-1: <criterion text, verbatim from 3-solution.md> | ⬜ | |
| REQ-2: <criterion text, verbatim from 3-solution.md> | ⬜ | |
```

These rows are for the person the spec is for to judge and tick from the
spec's Overview tab — never for `/aide-implement` or `/aide-analyze` to
tick (spec 285). `aide-archive-spec` refuses to archive while any of
them is still unticked. No Requirements section: `4-status.md` is
written exactly as it is today, with no such section.
