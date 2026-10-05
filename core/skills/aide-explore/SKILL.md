---
name: aide-explore
description: >-
  No-stakes thinking partner before /aide-create: explore a problem or idea,
  weigh approaches, sharpen the scope — without creating any files.
  Use when: an idea is not ready for a spec yet, weighing whether/how to
  do something, unclear scope, "what would it take to ...".
  Do NOT use for: creating specs (use aide-create), analysis of an existing
  spec (use aide-analyze), implementation.
argument-hint: "[topic, question or idea]"
effort: high
---

Think a problem through WITH the user before anything is committed to a
spec. Nothing is created, nothing is decided — the output is a sharper
understanding, and an offer to crystallize it.

**Input:** $ARGUMENTS (a topic, a question, or a half-formed idea)

## Ground rules

- **Create and modify NOTHING** — no specs, no files, no code, no git.
  Reading the codebase is allowed and encouraged.
- **This mode has no stakes.** Ideas may be bad; say so plainly and move
  on. Half of the value is discarding approaches cheaply, before a spec
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
   would we need to find out first? What breaks it? Ask the ones only the
   user can decide in rounds (below)
5. **Shrink the scope.** Ask what the smallest version worth doing is —
   most ideas leave exploration smaller than they arrived.

## Asking in rounds

Ask in rounds. A round holds every question that can be decided with the
answers given so far; a question whose answer depends on one still open
waits for a later round. Number the questions on from the last round and
letter each one's options, the way the communication rule's "Answering
'do we have anything outstanding?'" does, so a reply can be "3c" — and
give each question the answer you recommend, and why.

Find the facts yourself, in the code and the environment (config,
installed tools, versions), and state each with file:line or the command
that showed it. Ask the user only for decisions.

## Ending the exploration

When no question is left open, summarize the shared understanding: the
sharpened problem, the approach chosen and the answers that shaped it.
Ask the user to confirm it. Offer the handoff only once they have. If the
user asks to wrap up while a question is open or the summary is not
confirmed, offer no handoff and name what is still open. The handoff:

```text
Ready to make this a task?

/aide-create "<the title>" <the sharpened description>

Or leave it here — nothing has been created.
```

If the user takes the handoff, carry the conclusions into the description
so the exploration is not repeated in the analysis phase.
