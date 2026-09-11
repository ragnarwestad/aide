# Error sentences

The one rule every error the board shows follows: a mark's sentence, a job's `error`, a landing's refusal, a queue
refusal. The producers themselves are spread across [A job's states](job-states.md), [Branches and landing](landing.md)
and [The specs list and the spec page](the-specs-list.md) — this page is the convention all of them share, so the
next sentence is written the same way.

## Table of contents

- [The three parts](#the-three-parts)
- [The shared builder](#the-shared-builder)
- [An error that has resolved itself](#an-error-that-has-resolved-itself)
- [Words the reader does not use](#words-the-reader-does-not-use)

---

## The three parts

An error sentence has up to three parts, in order:

1. **What happened** — plain language, never raw tool output.
2. **What resolves it** — named as either a control on the board (the button, the tab, the page) when the fix is a
   press away, or a location off the board (the checkout on the serving host, a terminal) when it is not.
3. **Optional detail** — git/tool output MAY follow, as hover detail on the sentence, never as the sentence itself.

A sentence carries part 2 unless there is genuinely nothing to resolve — the fact is stated and that is the whole
answer (`ARCHIVED_REFUSAL` in `src/serve/serve-helpers/redirect.ts` is the model case: editing an archived spec is
intentionally impossible, not a gap).

## The shared builder

`src/format/error-sentence.ts` composes parts 1 and 2 for every sentence built this way — a neutral spot, since its callers are `queue/parse-request.ts` and `git/specs-pull.ts`, not the render layer itself:

```typescript
const PUSH_ERROR_SENTENCE = errorSentence({
  what: "A step's push did not reach origin.",
  resolve: "Pull the branch in the checkout on the serving host, then push it again from a terminal.",
}).text;
```

It throws if given neither `resolve` nor `exempt` — a sentence built this way cannot skip part 2 by accident. A
lower-level helper deep in a call chain (`branch-merge.ts`'s `refuse()`, `aide-run-spec`'s own `refuse()`) does not
call the builder — it keeps returning a plain string — but follows the same `what — resolve` shape by hand, so a
reader sees one convention regardless of which layer wrote the words.

`dashboard/test/render/ui/error-sentence-registry.test.ts` (and its bash-side counterpart in
`tests/specs/unit/core/scripts/run_spec_project_state.py`, checked by
`test_aide_run_spec_claims.py`) is the registry: every sentence the board can show is listed
there with the resolution phrase its own current text must contain, or the reason it is exempt. It grows as each
sentence is migrated to this convention — an entry is added once a sentence is fixed, not before.

## An error that has resolved itself

An error that has resolved itself — the work reached origin another way — is cleared, not shown with advice that no
longer applies. `group-builders.ts`'s `pushError` reads the spec's LEAD job, not the newest job that happens to have
one set, for exactly this reason: an older job's failed push must not outlive a newer job that pushed fine.

## Words the reader does not use

`src/i18n/banned-words.ts` lists the words a message may not use, in either language, and what to say instead —
"landing" for a merge, "spesifikasjon" for a spec, "sammenslåing"/"slå ... sammen" for a merge. `banned-words.test.ts`
reads every entry in `messages.ts`, `en.ts` and `nb.ts` against that list, so a new message reaching for one of them
fails on sight.
