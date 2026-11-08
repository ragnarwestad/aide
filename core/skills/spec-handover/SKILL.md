---
name: spec-handover
description: >-
  The format for handing over a spec agreed in the conversation as text the
  user pastes into the board's New spec form: the four parts (Prosjekt,
  Tittel, Beskrivelse, Avhengigheter), one fenced block each, what goes
  under Beskrivelse, and when a dependency may be named.
  Use when: a spec has been agreed in the conversation and its text is to be
  handed over, "skriv spec-teksten", "gi meg specen", proposing a new spec.
  Do NOT use for: creating the spec (`aide create`, and only when the user
  asks), analysing an existing spec (use aide-analyze).
effort: medium
---

# Handing over a spec

A spec agreed in the conversation is handed over as text, and it ends there:
the user creates it from the dashboard. When the user asks you to create it,
run `aide create <project> "<title>"` for each spec, with the description on
standard input, `--depends-on` for each dependency and
`--acceptance-not-required` unless the user wants acceptance ticked. It
queues the create on the board as the New spec form does. Where `aide`
answers that the project has no board, invoke `/aide-create` instead. Never
the board's HTTP routes, `aide-create-spec` by hand, or the files written
directly.

1. **Ask first.** Raise the choices the spec depends on — thresholds,
   scope, dependencies on other specs — before writing the text, not as
   a list of open questions after it.
2. **Hand over four parts, always, in this order:** Prosjekt (the
   project the spec belongs to), Tittel, Beskrivelse and Avhengigheter
   (Depends on). Beskrivelse is everything the New spec form's one
   Description field takes: a `## Problem` section saying what is wrong,
   a `## Solution` section saying what should be true afterwards,
   `## Out of scope` when there is one, and last `## Acceptance criteria`
   with the `- **AC-n:**` lines, each one sentence in one of the five
   EARS patterns the spec-structure rule lists. The criteria never go in
   a block of their own: the form has no field for them, and a label
   pasted with them ends up in the spec's text. A part with nothing in it
   is still handed over as the label followed by "ingen"
   (`**Avhengigheter:** ingen`), with no reason given. Avhengigheter names
   only a spec with a queued, running or landing job, never one that is
   archived or closed: check the board in the same reply.
   **Every requirement under Solution has a criterion of its own** — a
   help text, a documentation page, a default — so the create step's AI
   has none to add.
3. **Each part in a fenced code block** (` ```markdown `), one
   block per part — never as rendered text between `---` lines. The
   terminal renders markdown, and what the user copies is what it
   shows: `## Out of scope` arrives as a plain line, and backticks and
   `**` vanish. A code block is shown and copied exactly as written. An
   empty part has no block.
4. **A label above each part**, as plain bold text outside the block:
   `**Prosjekt:**`, `**Tittel:**`, `**Beskrivelse:**`,
   `**Avhengigheter:**`, with a blank line between the parts. The blocks
   look alike, and the user pastes each into its own field.
5. **No number.** The number is assigned when the spec is created, not
   by whoever writes the text; don't call it "spec 02".

Don't offer to create it afterwards either. The same goes for an
existing spec's files: the aide commands write them, never a hand edit
proposed in the conversation.
