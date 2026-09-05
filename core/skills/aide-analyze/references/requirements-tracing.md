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
`## Notation`, with exactly one row per REQ-n id from `1-description.md`,
in ascending id order, starting unticked:

```markdown
## Acceptance criteria

| Task | Status | Notes |
|------|--------|-------|
| REQ-1: <requirement text, verbatim from 1-description.md> | ⬜ | |
| REQ-2: <requirement text, verbatim from 1-description.md> | ⬜ | |
```

These rows are for the person the spec is for to judge and tick from the
spec's Overview tab — never for `/aide-implement` or `/aide-analyze` to
tick (spec 285). `aide-archive-spec` refuses to archive while any of
them is still unticked. No Requirements section: `4-status.md` is
written exactly as it is today, with no such section.

The run itself may say ticking is not required (spec 386): when the
prompt states this, write a `## Acceptance criteria` heading followed by
ONE plain sentence — "Acceptance ticking was not required for this
run." — never a table row. A reader can then tell "nobody wrote
requirements" (no heading at all) apart from "requirements exist and a
deliberate choice skipped the tick" (the heading, with this one line
under it). Requirements are still written into `1-description.md`
exactly as they are today (REQ-6) — this branch changes `4-status.md`
alone. Running analyze again on the same spec WITHOUT the switch writes
the ordinary table (REQ-7): the prompt says nothing that run, so the
first branch above applies as if this paragraph did not exist.
