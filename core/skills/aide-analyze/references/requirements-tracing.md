# Acceptance criteria tracing: AC-n through the analysis

When 1-description.md has a `## Acceptance criteria` section, /aide-analyze
threads its AC-n ids through the rest of the spec. No section present:
every step below is unchanged from today's plain-text behavior.

## Step 1 (read the description)

Extract every AC-n id (matched by `^- \*\*AC-\d+:\*\*`). Keep the
list for Steps 5-7.

## Step 5 (2-analysis.md)

Prefix a finding with the AC-id(s) it supports:
`AC-n → file:line — <reasoning>`. A finding tied to no particular
requirement stays unprefixed free text, exactly as today.

## Step 6 (3-solution.md, Acceptance criteria)

Each criterion opens with the AC-id it covers:
`1. **AC-1** — Given ... when ... then ...`. Several criteria may
share one id; every id from Step 1 must be covered by at least one.
No Acceptance criteria section: criteria stay in today's plain form.

## Step 7 (Review the plan)

New must-fix check, folded into the Coherence reviewer: every AC-id
from Step 1 must appear in at least one Acceptance criterion. A missing
id is a must-fix. A plain-text check the reviewing session performs
itself, reading the two files — no dashboard, no pytest.

## Step 8 (4-status.md, Acceptance criteria section)

Add a `## Acceptance criteria` section to `4-status.md`, placed after
the last implementation phase (e.g. `## Phase 4: REFACTOR`) and before
`## Notation`, with exactly one row per AC-n id from `1-description.md`,
in ascending id order, starting unticked:

```markdown
## Acceptance criteria

| Task | Status | Notes |
|------|--------|-------|
| AC-1: <requirement text, verbatim from 1-description.md> | ⬜ | |
| AC-2: <requirement text, verbatim from 1-description.md> | ⬜ | |
```

A row's Notes cell stays empty when its requirement is tested as
written by an ordinary test. Otherwise it carries ONE sentence, so the
person ticking the row sees what the plan decided without reading it:

- `Read as: <the reading>` — the plan chose what an unclear
  requirement means.
- `Not tested: <why>; check <what to look at>` — no criterion for this
  id is verifiable by a test, and here is what to look at instead.
- `Browser test: <what it shows>` — a criterion for this id is tagged
  *(browser)*, and a browser test is its proof.

Where more than one applies, the first in this list is the sentence.

These rows are for the user the spec is for to judge and tick from the
spec's Overview tab — never for `/aide-implement` or `/aide-analyze` to
tick (spec 285). `aide-archive-spec` refuses to archive while any of
them is still unticked. No Acceptance criteria section: `4-status.md` is
written exactly as it is today, with no such section.

## A held-back spec's second round

A spec whose archive is held back on unticked `## Acceptance criteria`
rows, and whose `4-status.md` carries a `**Round boundary:**` stamp
(written by `aide-archive-spec` the moment it declined), is not a fresh
analysis — it is taking ANOTHER round on the checks that are still
open. This is a THIRD kind of restart, distinct from `/aide-reopen` and
`/aide-reset`: those regenerate `2-analysis.md`/`3-solution.md`/
`4-status.md` from their templates and drop history; a held-back round
does the opposite on every point below.

**Scope.** Work out which `AC-n` ids are IN SCOPE before Step 5: every
id whose `4-status.md` row is still `⬜`, plus any id newly added to
`1-description.md` since the last round (an id `4-status.md` has no row
for at all). A TICKED id (`✅`) is approved, and this round changes
nothing behind it — no finding, no scenario, no file edit traces to it.

**Step 5 (2-analysis.md).** Append a `## Round N` subsection (N = one
more than the highest existing round subsection, or 2 if this is the
first held-back round) naming the in-scope ids and containing this
round's own findings, prefixed exactly as Step 5 above already
prefixes them. The earlier round's own content — including its own
`## Round` subsections, if any — is left untouched above it.

**Step 6 (3-solution.md).** Same append: a new `## Round N` subsection
with this round's own Approaches/Recommended solution/Acceptance
criteria/Implementation plan, scoped to the in-scope ids only. A
criterion for an id outside this round's scope must not appear in it.

**Step 7 (Review the plan).** The coherence reviewer's must-fix check
(below) is scoped to this round's own ids: every in-scope id from the
Scope step above must appear in the NEW round's own Acceptance criteria
subsection — an out-of-scope id appearing there is itself a must-fix
(scope creep onto a ticked or not-yet-reached criterion).

**Step 8 (4-status.md, Acceptance criteria section).** The table is
never regenerated. Append a new unticked row for each genuinely NEW id
(numbered after the highest existing one, per `spec-structure.md`'s own
numbering convention) — never for an id that already has a row. Every
existing row's Status cell and Task-cell text are left byte-for-byte as
found, ticked or not. This is also the one exception to
`aide-implement`'s own "never touch the Acceptance criteria section"
rule: see `core/skills/aide-implement/SKILL.md` for the narrow carve-out
that lets Implement write an open row's Notes cell — rewritten from
scratch each round, one or two sentences on what is missing for a
user to tick, with this round's own findings going into the
`## Round N` sections above instead.

**Nothing here is ticked by any skill**, in this round or any other —
that judgment stays the spec's own user's, exactly as the un-held-back
case above.

---

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
