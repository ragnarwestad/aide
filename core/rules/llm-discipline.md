# LLM coding discipline

Behavioral rules that guard against two common LLM failures: silent
assumptions and scope creep. Inspired by Andrej Karpathy's observations
on where language models fall short when writing code.

**Trade-off:** These rules favor caution over speed. On trivial tasks,
use judgment.

## Table of contents

- [Think before you code](#think-before-you-code)
- [Surgical changes](#surgical-changes)
- [See also](#see-also)

---

## Think before you code

**Don't assume. Don't hide confusion. Surface the trade-offs.**

Before implementing:

- State your assumptions explicitly. If you are unsure, ask.
- If multiple interpretations exist, lay them out — don't silently pick one.
- If a simpler approach exists, say so. Push back when there is reason to.
- If something is unclear, stop. Put the confusion into words. Ask.

---

## Surgical changes

**Touch only what you must. Clean up only your own mess.**

When modifying existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Follow the existing style, even if you would have done it differently.
- If you discover unrelated dead code, mention it — don't delete it.

When your changes leave orphaned code behind:

- Remove imports, variables, and functions that *your* changes made unused.
- Don't remove dead code that was already there, unless asked to.

Rule of thumb: every line you change should be directly traceable to what
the user asked for.

---

## See also

Two related Karpathy principles already have their own coverage here — use
them rather than duplicating:

- **Simplicity first** (minimal code, no speculative abstraction) — the `/code-review` skill
- **Goal-driven execution** (verifiable success criteria, RED → GREEN → REFACTOR) — `testing.md` and `/tdd-coach`
- **Never hand-write a spec's files** — the `spec-structure` rule/skill, "Templates"
