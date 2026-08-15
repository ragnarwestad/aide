---
name: aide-review-plan
description: >-
  Review the implementation plan in 3-solution.md BEFORE the RED phase:
  reviewers with distinct perspectives (feasibility, scope, coherence)
  attack the plan, findings become must-fix/should-fix, and the plan is
  REVISED — not just annotated.
  Use when: an analysis is complete and 3-solution.md is filled in,
  before /aide-implement, quality-checking a plan.
  Do NOT use for: reviewing code (use /code-review), creating the plan
  (use /aide-analyze), specs without a filled-in solution.
argument-hint: "[<JIRA-KEY> or spec number]"
effort: high
---

Attack the plan while mistakes are still cheap: between `/aide-analyze`
and `/aide-implement`, before any test is written.

**Input:** $ARGUMENTS (a JIRA key, a spec number, or a full folder ID)

## Workflow

### Step 1: Resolve and read

- Resolve the argument to a spec folder (same rules as the other aide
  skills: number shorthand, JIRA key, or full `NN-slug`)
- Read all four files. If `3-solution.md` is not filled in, stop and
  point to `/aide-analyze`.

### Step 2: Review — scaled to complexity

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
   behavior delta match what the steps actually do?

### Step 3: Consolidate

Merge the findings into three lists: **must-fix** (the plan is wrong or
unbuildable), **should-fix** (weakness, worth fixing now), **notes**
(observations, no action). Deduplicate across reviewers.

### Step 4: Revise — the review is not a stamp

1. Write a **Plan review** section into `3-solution.md` (after
   Acceptance criteria): verdict per perspective, the three lists, and
   what was changed in response.
2. **REVISE the plan for every must-fix** — the sections of
   `3-solution.md` are updated, not just commented on. Should-fix items
   are revised or explicitly declined with a reason.
3. Add a review row to `4-status.md`.

A review with zero findings is possible and fine — say so plainly and
record the verdict. Never invent findings to look thorough.

### Step 5: Confirm

Show a summary: verdict per perspective, counts (must-fix/should-fix),
what was revised. Then:

```text
Plan reviewed: 78-project-manifest (2 must-fix revised, 1 should-fix declined)

Next step: /aide-implement 78
```

IMPORTANT:
- Findings about the SOLUTION belong in `3-solution.md` only — never
  touch `1-description.md`, and only touch `2-analysis.md` if the review
  exposed a factual error in it (say so explicitly)
- Code blocks ALWAYS end with just ` ``` `
