# Error sentences

## Table of contents

- [The two lines](#the-two-lines)
- [Only what was checked](#only-what-was-checked)
- [The shared builder](#the-shared-builder)
- [An error that has resolved itself](#an-error-that-has-resolved-itself)
- [Words the reader does not use](#words-the-reader-does-not-use)

---

The one rule every error the board shows follows: a mark's sentence, a job's `error`, a landing's refusal, a queue
refusal. The producers themselves are spread across [A job's states](job-states.md), [Branches and landing](landing.md)
and [The specs list and the spec page](the-specs-list.md) — this page is the convention all of them share, so the
next sentence is written the same way.


## The two lines

An error message has two lines, and detail behind them:

1. **Problem:** what happened, in plain language, never raw tool output.
2. **Solution:** one fix, on a line of its own under the problem. It names either a control on the board (the button,
   the tab, the page) when the fix is a press away, or a place off the board (the checkout on the serving host, a
   terminal) when it is not.
3. **Detail:** git's or a tool's own output MAY follow, behind the message's (?), never on either line.

For example:

```text
Problem: Creating "A create that fails" in aide-test failed: the model stopped before it wrote the spec.
Solution: Press Try again to open the form with what you typed, then press Create.
```

- **One fix, never several.** A message with more than one way out names the one that resolves it here.
- **No Solution line when there is nothing to resolve.** The problem is stated and that is the whole answer
  (`ARCHIVED_REFUSAL` in `src/serve/serve-helpers/edit-sentences.ts` is the model case: editing an archived spec is
  intentionally impossible, not a gap).
- **The labels are in the reader's language**, as the rest of the board is: "Problem" and "Løsning" in Norwegian.

### In the message catalog

Every entry in `src/i18n/messages.ts` holds the problem in its language texts and the fix in `solution`, one text per
language; `solution: null` is a message with nothing to resolve, and `exempt` says why. The composer
(`src/i18n/message.ts`) writes the labels and the line break, and starts each line with a capital, so the catalog's
own texts stay lowercase. A test fails for an entry with neither.

An entry that only informs, such as a check that passed, a run that finished or a wait that ends by itself, has no
`solution` and says why in `statement`. It is shown as its sentence alone, with no Problem or Solution label.

### A message inside another

A message whose text has a `{message}` blank takes only the problem of the message inside it, and the message shows one
Solution line: the outer message's own fix when it has one, and otherwise the fix of the message inside it. An outer
message whose inner message knows the better fix carries no fix of its own.

### Several messages on one row

Messages that share a fix share one Solution line, their problems joined on one Problem line. A message with a fix of
its own gets a Problem and a Solution line of its own.

### Capital letters

The row's own text starts with an uppercase letter, once, at render time, in `rowMessage`/`rowMessageParts`
(`src/render/ui/components/message.ts`) and the job detail page's own banner — and in `writeLine()`
(`src/specs-client/press.ts`) for a line the page's script fills — never in the message catalog, which stays lowercase
because its entries are reused both on their own and glued behind a phase name.

## Only what was checked

A sentence claims no more than the code that wrote it has checked.

- **A cause is named only when something shows it.** "The fault is likely in the change" or "that points to unstable
  tests" is said only when the evidence for it is in hand. A test file that is red each time it runs alone is not
  unstable. Where nothing points either way, the sentence says what failed and stops there.
- **The failure itself comes first, not only its name.** A failing test's own error line ("not found", "timed out",
  "expected 3, received 0") is part of what happened. A sentence that names the test and leaves out what it hit sends
  the reader to the log for the one fact they needed.
- **A guess is worded as one.** "Likely" and "points to" mark a judgement, and they are kept for the cases where the
  check behind the judgement is real; a fact is stated without them.

## The shared builder

`src/format/error-sentence.ts` composes the problem and its fix for every sentence built this way, and returns them
apart as `problem` and `solution` beside the one-line `text`:

```typescript
const PUSH_ERROR_SENTENCE = errorSentence({
  what: "A step's push did not reach origin.",
  resolve: "Pull the branch in the checkout on the serving host, then push it again from a terminal.",
});
```

It throws if given neither `resolve` nor `exempt`. `writtenMessage(problem, solution)` stores a pair written in English
as the catalog's `message.written` message, which the composer draws as the two lines. A route answers a refusal with
`error` for the problem and `solution` for the fix, and the page writes them as the two lines.

`aide-run-spec` gives an error's fix apart as well: `refuse_fix <problem> <fix>` for a refusal and `error_solution`
beside `error_msg` for a step's result, written as `errorSolution` beside `error`. A job stored before that has `error`
alone and reads as it was stored.

`RUNNER_ERROR_REGISTRY` in `core/tests/specs/unit/core/scripts/run_spec/run_spec_error_registry.py`, checked by
`run_spec/test_runner_error_solutions.py`, covers every error `aide-run-spec` writes: each is listed with the fix it
gives apart, or the reason it has none.

## An error that has resolved itself

An error that has resolved itself — the work reached origin another way — is cleared, not shown with advice that no
longer applies. `group-builders.ts`'s `pushError` reads the spec's LEAD job, not the newest job that happens to have
one set, for exactly this reason: an older job's failed push must not outlive a newer job that pushed fine.

## Words the reader does not use

A message does not use these words, in either language: "landing" (say merge), "spesifikasjon" (say spec),
"sammenslåing"/"slå ... sammen" (say merge), "gate" (say test, test log or test run), and "Run again" (name the
phase's own button: "{button} again").
