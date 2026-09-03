# LLM coding discipline

Behavioral rules that guard against two common LLM failures: silent
assumptions and scope creep. Inspired by Andrej Karpathy's observations
on where language models fall short when writing code.

**Trade-off:** These rules favor caution over speed. On trivial tasks,
use judgment.

## Table of contents

- [Think before you code](#think-before-you-code)
- [Surgical changes](#surgical-changes)
- [Documentation describes now, not history](#documentation-describes-now-not-history)
- [See also](#see-also)

---

## Think before you code

**State assumptions explicitly and surface trade-offs.**

Before implementing:

- State your assumptions explicitly. If you are unsure, ask.
- Lay out multiple interpretations when they exist, rather than silently picking one.
- If a simpler approach exists, say so. Push back when there is reason to.
- If something is unclear, stop. Put the confusion into words. Ask.

---

## Surgical changes

**Touch only what the task requires. Clean up only your own mess.**

When modifying existing code:

- Leave adjacent code, comments, and formatting as they are.
- Leave working code alone rather than refactoring it.
- Follow the existing style, even if you would have done it differently.
- Leave unrelated dead code in place, and mention it.

When your changes leave orphaned code behind:

- Remove imports, variables, and functions that *your* changes made unused.
- Leave dead code that was already there, unless asked to remove it.

Rule of thumb: every line you change should be directly traceable to what
the user asked for.

---

## Documentation describes now, not history

**A README, a CLAUDE.md, or any other living doc says how the system
works TODAY — never a chronicle of how it got there.**

- Never write "spec N did X because Y" or "on DATE, Z happened" as the
  justification for a rule inside a living doc. Git history, blame and
  commit messages are where that belongs — a reader of the doc wants
  the current behavior, not its excavation.
- State the rule and, if a reason genuinely helps, the ONE-LINE
  invariant it protects — not the story of the incident that found it.
- This applies whenever a change happens to touch documentation, not
  only to a spec whose job is documentation — an implement step that
  updates a README is bound by this exactly as a dedicated doc spec is.
- A doc that keeps growing because every change appends its own
  paragraph of justification is the failure mode this guards against:
  size should track what the system does, not how many changes it took
  to get there.

---

## See also

Two related Karpathy principles already have their own coverage here — use
them rather than duplicating:

- **Simplicity first** (minimal code, no speculative abstraction) — the `/code-review` skill
- **Goal-driven execution** (verifiable success criteria, RED → GREEN → REFACTOR) — `testing.md` and `/tdd-coach`
- **Never hand-write a spec's files** — the `spec-structure` rule/skill, "Templates"
