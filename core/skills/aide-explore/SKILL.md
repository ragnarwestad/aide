---
name: aide-explore
description: >-
  No-stakes thinking partner before /aide-create: explore a problem or idea,
  weigh approaches, sharpen the scope — without creating any files.
  Use when: an idea is not ready for a report yet, weighing whether/how to
  do something, unclear scope, "what would it take to ...".
  Do NOT use for: creating reports (use aide-create), analysis of an existing
  report (use aide-analyze), implementation.
argument-hint: "[topic, question or idea]"
effort: high
---

Think a problem through WITH the user before anything is committed to a
report. Nothing is created, nothing is decided — the output is a sharper
understanding, and an offer to crystallize it.

**Input:** $ARGUMENTS (a topic, a question, or a half-formed idea)

## Ground rules

- **Create and modify NOTHING** — no reports, no files, no code, no git.
  Reading the codebase is allowed and encouraged.
- **This mode has no stakes.** Ideas may be bad; say so plainly and move
  on. Half of the value is discarding approaches cheaply, before a report
  gives them weight.
- **Do not drift into implementation.** When the talk turns into "then
  let's build it", hand over to `/aide-create` instead of coding.

## How to explore

Adapt to what the user brings — a vague itch needs different help than a
finished plan looking for holes. Useful moves:

1. **Restate the problem** in one sentence and check it landed. Many
   explorations end right here, with "no, the actual problem is ...".
2. **Look before speculating.** Read the relevant code first; ground every
   claim in `file:line`, not in what the code probably does.
3. **Lay out 2-3 approaches** with real trade-offs — including "do
   nothing" when it is a serious contender. Name what each choice locks in.
4. **Surface the unknowns**: what must be true for this to work? What
   would we need to find out first? What breaks it?
5. **Shrink the scope.** Ask what the smallest version worth doing is —
   most ideas leave exploration smaller than they arrived.

## Ending the exploration

Summarize in a few lines: the sharpened problem, the leading approach and
why, the open questions. Then offer the handoff:

```text
Ready to make this a task?

/aide-create TODO <the sharpened one-line description>
/aide-create <JIRA-KEY>          # if it belongs to a JIRA issue

Or leave it here — nothing has been created.
```

If the user takes the handoff, carry the conclusions into the description
so the exploration is not repeated in the analysis phase.
