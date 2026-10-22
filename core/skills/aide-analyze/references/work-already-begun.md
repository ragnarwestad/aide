# Work already begun: the four cases that rewrite the files

## Table of contents

- [A run stopped on the acceptance criteria or a limit](#a-run-stopped-on-the-acceptance-criteria-or-a-limit)
- [A spec implement sent back](#a-spec-implement-sent-back)
- [Another approach chosen](#another-approach-chosen)
- [A spec landed since the analysis](#a-spec-landed-since-the-analysis)

---

## A run stopped on the acceptance criteria or a limit

One exception: when `2-analysis.md`'s Tracking info reads `Result:
stopped (acceptance-criteria)` or `Result: stopped
(short-analysis-over-limit)`, the earlier run stopped on the
acceptance criteria, or wrote a short analysis for a spec over a limit,
and the description has been put right since. After the second, write the
full analysis (Step 3).
Treat every section that run wrote as unwritten, and write the three
files afresh. On a held-back round, replace that round's own `## Round
N` subsections rather than appending a new round.

## A spec implement sent back

A second exception, for a spec implement sent back: the description's
Tracking info has a `Sent back to a full analysis:` line, and `2-analysis.md`
reads `Analysis: short`. The short analysis was too small for the spec, so
treat every section as unwritten and write the three files afresh as a full
analysis (Step 3), keeping `### Overlapping specs` as it stands and the
lines the runner wrote into each file's Tracking info (`Repo`, `Model`,
`Result`, `Attempts`, `Cost` and the like).

## Another approach chosen

A third exception: the newest round of `3-solution.md` records a
`**Chosen approach:** Approach X` line under its Approaches heading, and
that approach's lead is not the one marked `(recommended)`. The person
chose another approach on the Specs list. Move `(recommended)` to the
chosen approach's lead and give the lead that carried it `(real
alternative)`; keep every other lead and the chosen line word for word.
Write `### Recommended:` and every section below it afresh for the chosen
approach, and `4-status.md`'s phase tables for the new plan. Leave
`2-analysis.md` as it stands. A chosen line on the recommended approach
needs nothing: the choice is made, and is never asked again.

## A spec landed since the analysis

A fourth exception: `aide-spec-overlap --specs-root <root> --spec XX-slug`
lists a spec under `landed`. The analysis was made against code that has
changed since, so treat every section as unwritten and write the three
files afresh, keeping `### Overlapping specs` as it stands. Step 6's
`--record` then drops the archived spec from the record, so the rewrite
happens once.
