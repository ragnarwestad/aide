# Communication rules

Rules for how the AI assistant presents text in the conversation with the user.

## Table of contents

- [Plain Norwegian — no invented or stilted words](#plain-norwegian--no-invented-or-stilted-words)
- [Answering "do we have anything outstanding?"](#answering-do-we-have-anything-outstanding)
- [Suggested text the user will copy out](#suggested-text-the-user-will-copy-out)

---

## Plain Norwegian — no invented or stilted words

Write ordinary, everyday Norwegian. This is the single most repeated piece of feedback the user has
given — across projects and across many sessions — and it keeps happening, so treat it as a hard rule
and **re-read your own reply before sending it**.

**The test:** would a Norwegian colleague say this out loud in a conversation? If not, rewrite it.

**The three failure types:**

1. **Process jargon** — "paritet", "skive", "fase", "gate/gated", "lekkasje" (say "frafall"), "trakt",
   "chrome" (about UI), "bøtte" (bucket), "røret" (pipeline), "maskiner" (say "AI-assistenter").
2. **Anglicisms with Norwegian endings** — "scopet", "trigge", "pushe" (outside the git command).
3. **Stilted words where an everyday one exists** — "setet" for "hovedstaden", "senteret", and other
   "finer" synonyms. This one sneaks in when SUMMARISING work that was explained plainly a moment
   earlier.

**One word per thing, all the way through.** Having written "hovedstad" in the explanation, write
"hovedstad" in the summary too — not a variation. The same goes for the user's own words: if he wrote
"FB reels", write "FB reels", never an abstraction over it ("kortvideo-formatet").

**Every sentence must stand alone.** No phrases that assume the reader followed your reasoning
("husets egen regel", "telleren er på plass — så tallet er ekte"). Spell references out: "regelen i
docs/X sier at …".

**Don't comment on the user's time or state** ("dette kan vente til i morgen", "med friske øyne"). He
runs his own evening.

Applies to the chat. English code comments and commit messages stay English.

---

## Answering "do we have anything outstanding?"

When the user asks "har vi noe utestående?", "utestående aksjoner?" or any variation, the answer is
a **numbered list of concrete outstanding actions — nothing else**. Number the points (1., 2., 3. …)
so the user can refer to them by number in the reply.

**Each point must be:**

- A specific action that is still to be done, described so it can be picked up without more context
- Something we have actually discussed but not prioritised, or a known bug or gap
- Followed by a proposed solution — not just the problem. Say what you would do about it.

**When the point has several possible solutions the user must choose between**, list them as
sub-bullets under the point, one per option, each with its advantages, disadvantages and
consequences. Consequences means what the choice drags along with it: what else has to change, what
it costs, what it locks in. Say which one you would pick and why.

**Letter the options a, b, c …** under the point's number, so the user can name one as "3c". Write
the letter at the start of the sub-bullet — `- **a.** Dynamiske tagger.` — and keep the lettering
restarting at `a` under every point. The user's reply may then be nothing but a reference like "ta
3c"; treat that as choosing that option and get on with it.

**Never include:**

- What has been done, what was committed, or any other status
- Whether the working tree is clean, tests are green, or the build passes
- Backlog headings without content ("see docs/SPEC.md") — write out the actual points
- Preamble, summary or closing remarks around the list
- **Missing content in the user's own data** — an exercise without an illustration, a routine
  without a description, a record with an empty field. That is the user filling in his own data,
  not work on the software. It does not belong in the action list, and it does not belong in the
  project's backlog either. Note it where the data lives (an assets README or similar) if it is
  worth writing down at all.

If there is genuinely nothing outstanding, say that in one sentence — do not fill the space with a
recap.

This rule applies to ALL projects and sessions.

---

## Suggested text the user will copy out

**Do not use markdown blockquotes (`> ` in front of each line)** when suggesting text the user will copy and paste somewhere else (Slack messages, PR comments, commit messages, emails, etc.).

**Why:** Blockquotes render as a vertical bar in the left margin of the terminal, and the `>` characters come along when copying. That makes the text unusable without manual cleanup.

**How:**

- Distinguish between text that is *your reply* (may use blockquotes/headers freely) and text that is *a suggestion for external use* (plain text, do not prefix each line with `>`).
- To visually delimit the suggested text, instead use `---` above and below, or a short lead-in like "Suggestion:" on the preceding line.
- Markdown for italics/bold/lists inside the suggestion is fine — it is only the blockquote prefix that is the problem.

**Example:**

Wrong:

```text
Suggested Slack message:

> Thanks for the review.
> We have cleaned up the code now.
```

Correct:

```text
Suggested Slack message:

---

Thanks for the review.
We have cleaned up the code now.

---
```

This rule applies to ALL projects and sessions.
