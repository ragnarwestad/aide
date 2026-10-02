# Plan review: attacking the plan before RED

Attack the plan while mistakes are still cheap: after `3-solution.md` is
written, before any test exists. This routine used to be its own skill,
`/aide-review-plan`, run as a separate step between `/aide-analyze` and
`/aide-implement`; spec 181 folded it into `/aide-analyze` itself, as the
step between writing `3-solution.md` and writing `4-status.md` — one run
now produces both the plan and its review.

The property that made a standalone step worth having is unaffected by
where it is invoked from: the reviewer(s) below are spawned as separate
Agent invocations (subagents), blind to the analyst's own reasoning —
they read only the four spec files on disk, never the conversation that
produced them. The Feasibility reviewer reads the project's own files as
well, from the project root the analyst hands it, since whether a part
exists is not in the spec. The Coherence reviewer is handed the
project's acceptance criteria checks level (`off`, `warn` or `stop`,
Step 1), since that is not in the spec either.

## Review — scaled to complexity

**LOW specs:** one combined pass over the three questions below. Keep it
short; a LOW plan rarely deserves three reviewers.

**MEDIUM/HIGH specs:** three reviewers, each with ONE perspective and no
sight of the others' findings. In Claude Code, run them as parallel
subagents (the Agent tool); in tools without subagents, run the same
three instructions as sequential passes.

Each reviewer reads the four spec files and answers ONLY its own
questions, with file:line references into the spec:

1. **Feasibility** — can this be built as described? Are the steps in
   an order that works? Are the estimates honest? Does the plan depend
   on anything that does not exist (files, tools, config)? Does it
   build anything that already exists? Read every file the manifest's
   `reuse` key names and search the code, then check the Parts list
   under Recommended solution. Each of these is a must-fix, given with
   the file:line that shows it: no Parts list; a part with no line of
   the three forms, `Reused:`, `New, because` or the single `None —`;
   a `Reused:` line whose part does not do the job; a `New, because`
   reason that names something the project already has; a `None —`
   line on a plan that does build a part.
2. **Scope guardian** — does the plan do MORE than `1-description.md`
   asks? Flag every planned change that is not traceable to the
   description. Flag missing pieces too: what does the description ask
   for that the plan never delivers?
3. **Coherence** — do the analysis, the acceptance criteria and the
   plan agree? Is every criterion testable as written? Does the
   behavior delta match what the steps actually do? Does every AC-n
   id from 1-description.md (when present) appear in at least one
   acceptance criterion? A missing id is a must-fix.

   **The acceptance criteria checks**, at the level the analyst hands
   it. At `off`, make none of the three. At `warn` and `stop`, make
   all three:

   - **No acceptance criteria:** `1-description.md` has no AC-n line.
     A should-fix, declined: the description is the user's to write.
   - **Not in EARS:** an AC-n line follows none of the five EARS
     patterns, its condition first:

     - `The <system> SHALL <response>`
     - `WHEN <trigger>, the <system> SHALL <response>`
     - `WHILE <state>, the <system> SHALL <response>`
     - `IF <condition>, THEN the <system> SHALL <response>`
     - `WHERE <feature>, the <system> SHALL <response>`

     Each criterion that follows none — a condition written after
     SHALL counts — is a should-fix that names its id and says why it
     follows none. Check every AC-n line, on another round too. The
     description is the user's to rewrite, so the plan declines it with
     that reason, reads the criterion as it stands, and does not count
     it as acted on.
   - **No scenario where the condition does not hold:** a criterion
     with a WHEN, WHILE or WHERE condition, wherever it is written, and
     no Given/when/then scenario in `3-solution.md` for the case where
     that condition does not hold. A must-fix: the plan is revised to
     add the scenario. It stands only when the plan cannot say what
     holds without the condition, and the plan then declines it with
     that reason.

## Consolidate

Merge the findings into three lists: **must-fix** (the plan is wrong or
unbuildable), **should-fix** (weakness, worth fixing now), **notes**
(observations, no action). Deduplicate across reviewers.

## Revise — the review is not a stamp

1. Write a **Plan review** section into `3-solution.md` (after
   Acceptance criteria): verdict per perspective, the three lists, and
   what was changed in response. Assemble the complete new file text and
   write it with `aide-write-spec --file 3-solution.md` (never
   Write/Edit — spec 282).

   The section opens with one Findings line, right under its heading:

   ```markdown
   **Findings:** 2 must-fix, 3 should-fix, 4 acted on
   ```

   The first two numbers are the lengths of the must-fix and should-fix
   lists below it; the third is how many of those the plan was revised
   for (a should-fix declined with a reason is not acted on). A review
   with nothing to fix writes `0 must-fix, 0 should-fix, 0 acted on`. A
   held-back round's own review opens with its own Findings line. The
   runner reads the three numbers into the step's log; a section without
   the line is logged as giving no counts.

   Right under it, one Criteria check line: the level, and the faults
   of the three checks that still stand after the revision.

   ```markdown
   **Findings:** 2 must-fix, 3 should-fix, 4 acted on
   **Criteria check:** stop — not in EARS: AC-2, AC-4; no scenario for when the condition does not hold: AC-5
   ```

   The line reads `**Criteria check:** off` at `off`, and
   `**Criteria check:** warn — none found` (or `stop — none found`)
   when nothing stands. Otherwise the text after ` — ` is one or more
   of these, joined by `; `, with the ids joined by `, `:

   - `no acceptance criteria`
   - `not in EARS: AC-2, AC-4`
   - `no scenario for when the condition does not hold: AC-5`

   At `stop`, the runner ends Analyze stopped when this line names any
   fault, and the reason it gives names each one.
2. **REVISE the plan for every must-fix** — the sections of
   `3-solution.md` are updated, not just commented on, the same way.
   Should-fix items are revised or explicitly declined with a reason.
3. Add a review row to `4-status.md`, ticked ✅ at write time — the review
   the two steps above just finished is already-done work, not something
   left for a user to confirm later. Write it the same way, with
   `aide-write-spec --file 4-status.md`. The row goes in its OWN `##
   Plan review` section — a `| Task | Status | Notes |` table, one row,
   right after `## Tracking info` and before `## Phase 1`, added to the
   Table of contents in the same position. Never fold this row into
   Phase 1's own table: Phase 1's rows are what `implement` ticks, and
   `aide-run-spec`'s analyze-scope guard (spec 268) refuses the whole
   step the moment ANY Phase-table row's status changes during
   analyze — ticking the review there, instead of in its own section,
   trips that guard and fails the run.

A review with zero findings is a review that happened, and is offered
like any other. Say so plainly and record the verdict. Never invent
findings to look thorough.

If `3-solution.md` is still an empty template — its bracketed
placeholder text unfilled — there is nothing to review; go back and
finish Step 6 (Create the implementation plan) first.

IMPORTANT:
- Findings about the SOLUTION belong in `3-solution.md` only — never
  touch `1-description.md`, and only touch `2-analysis.md` if the review
  exposed a factual error in it (say so explicitly)
