# Assessing overlapping work

## Table of contents

- [Assess the changes](#assess-the-changes)
- [Record the decisions](#record-the-decisions)
- [Complete the analysis](#complete-the-analysis)

---

## Assess the changes

A shared path is a candidate for review, not proof of a dependency. Read
both specs' descriptions, analyses and available plans, and inspect the
functions, contracts and tests each will change. Include previously
recorded overlaps that are still open; an earlier warning is not a decision.

## Record the decisions

For every candidate, record one line in `### Overlap decisions` in the
newest round of `2-analysis.md`, using `aide-write-spec`:

```markdown
- `<spec-folder>` — independent — <why the changes can proceed independently>
- `<spec-folder>` — depends — <what this work needs the other spec to finish first>
```

Use exactly `independent` or `depends`, and give a concrete, non-empty
reason on the same line. Changes to unrelated functions in the same file
are independent. A dependency needs a reason about the actual changes —
for example, this work consumes a contract the other spec replaces, or
both changes need to coordinate the same rule. Never choose `depends`
from the filename alone. Do not edit Depends on yourself.

## Complete the analysis

Continue to Step 7 and finish the plan and its review even when a
candidate needs to come first. If the plan changes the overlap assessment,
update the decisions before completing the step. The runner checks the
record after the turn: independent overlaps do not stop Analyze; a
required ordering carries its reason to the board. The board adds those
dependencies only after checking the complete chain for cycles, and queues
Analyze and its remaining steps to wait for them. Missing, contradictory
or unreasoned decisions stop the step without authorizing an automatic
change. A cycle leaves all dependencies unchanged and is shown with its
chain.

If the command is not installed, mark the comparison skipped and continue
to Step 7.
