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
produced them.

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
   on anything that does not exist (files, tools, config)?
2. **Scope guardian** — does the plan do MORE than `1-description.md`
   asks? Flag every planned change that is not traceable to the
   description. Flag missing pieces too: what does the description ask
   for that the plan never delivers?
3. **Coherence** — do the analysis, the acceptance criteria and the
   plan agree? Is every criterion testable as written? Does the
   behavior delta match what the steps actually do? Does every REQ-n
   id from 1-description.md (when present) appear in at least one
   acceptance criterion? A missing id is a must-fix.

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
2. **REVISE the plan for every must-fix** — the sections of
   `3-solution.md` are updated, not just commented on, the same way.
   Should-fix items are revised or explicitly declined with a reason.
3. Add a review row to `4-status.md`, ticked ✅ at write time — the review
   the two steps above just finished is already-done work, not something
   left for a person to confirm later. Write it the same way, with
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
