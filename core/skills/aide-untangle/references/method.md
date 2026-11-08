# Untangle: the method

The questions to ask, how to count the size limits, and how to keep the
decision log. Adapted from caldoai's
[untangle-codebase](https://github.com/caldoai/skills/blob/main/skills/untangle-codebase/SKILL.md),
which makes the fixes itself; `aide-untangle` stops at the spec text.

## Table of contents

- [The one question](#the-one-question)
- [Hidden links](#hidden-links)
- [Needless links](#needless-links)
- [Surplus](#surplus)
- [Special cases](#special-cases)
- [Counting](#counting)
- [Reading a large codebase](#reading-a-large-codebase)
- [Decision log](#decision-log)
- [Brief for a subagent](#brief-for-a-subagent)

---

## The one question

Ask of every piece: **should it change together with the pieces it is
tied to?** There are three ways the code gets the answer wrong, and each
section below lists what they look like. Special cases are the fourth
thing to write down: they are not a wrong answer, they are the evidence
of a requirement the design never took in.

## Hidden links

Pieces that must change together, where nothing in the code shows it.

- **Copies of logic or values.** Change one and the others must change
  too, but nothing says so. The same list of names in two languages, the
  same threshold in two files.
- **A module that reads a global, an environment variable or a file
  another module sets.** Change the writer and the reader breaks, with no
  import between them to show it.
- **A feature split across folders by layer,** or related code kept
  apart. One change needs all of them, and the layout hides that.
- **A call order or convention callers just have to know.** Change it and
  callers break, with nothing to warn them.

## Needless links

Pieces tied together that change for different reasons.

- **Callers that depend on internals.** The internals change for their
  own reasons, and the callers break anyway.
- **Stable code that imports something more volatile.** The stable code
  has to change whenever the volatile one does.
- **A general function with a parameter only one caller understands.**
  The function changes whenever that caller does.
- **A shallow module,** whose interface changes whenever its internals
  do, so every caller changes with it.

## Surplus

Pieces with no reason of their own to change.

- **Pass-through wrappers.** They change only when what they wrap does.
- **Extension points and config for things that never vary.** Nothing
  will ever change them.
- **Dead code.** Nothing uses it. Check with a search for every name it
  exports, including from scripts, config and tests, before calling it
  dead.

## Special cases

Code that exists for one situation instead of following from how the
system works. Each is a requirement the design never accounted for, so
read them together to work out what the system needs to be.

- An `if` for one value
- A parameter for one specific caller
- A swallowed exception
- A retry or a sleep
- A disabled or skipped test

Several special cases with one cause are one finding, and its fix is the
concept that is missing.

## Counting

Use the project's own limits and its own check when it has one (a
code-health test, a lint rule). Otherwise count files git tracks, so
generated output and dependencies stay out:

```bash
# Files over the line limit (source 500, test 800), Markdown and binaries excluded
git ls-files -z | xargs -0 grep -Il '' 2>/dev/null | tr '\n' '\0' \
  | xargs -0 wc -l 2>/dev/null \
  | awk '$2 != "total" && $2 !~ /\.md$/ {
      limit = ($2 ~ /(test|spec)/) ? 800 : 500
      if ($1 > limit) print $1, $2
    }' | sort -rn

# Folders with more than 15 files directly inside them, Markdown excluded
git ls-files | grep -v '\.md$' \
  | awk -F/ 'NF > 1 { NF--; print }' OFS=/ | sort | uniq -c \
  | awk '$1 > 15' | sort -rn
```

Adjust the test pattern to the project's own naming (`_test.go`,
`test_*.py`, `*.test.ts`). Data files, lockfiles and fixtures are not
source: leave them out and say so.

## Reading a large codebase

- **Start from a skeleton.** Strip function bodies with a script, so the
  outline of the whole codebase fits in context at once.
- **Summarise with subagents.** One per top-level folder or module, each
  returning what the part does, what it imports and what imports it.
- **Draw the import graph** with a script, and look for imports that
  point from stable code to volatile code.
- **Use git as evidence.** Files that change in the same commits belong
  together, whatever the folders say. The files changed most often:

  ```bash
  git log --since=6.months --name-only --format= | grep . \
    | sort | uniq -c | sort -rn | head -30
  ```

  And what changes beside one of them:

  ```bash
  git log --since=6.months --full-diff --name-only --format= -- <file> | grep . \
    | sort | uniq -c | sort -rn | head -15
  ```

  That second list counts the files in the commits that touched
  `<file>`, so a file near the top that lives in another folder is a
  hidden link worth reading.

- **Start where the leverage is highest:** the files that change most
  often, and the ones the most other files import.

## Decision log

Keep the list in a file in the scratchpad, not only in the conversation,
so it survives compaction. First the findings, one line each:

```md
- `ui/LogoutDialog.tsx:30` waits 100 ms after closing and hopes the input can take focus by then. (special case)
- `ui/Toolbar.tsx:40` and `ui/Menu.tsx:22` call the same actions, each with its own check for when they are disabled. (hidden link)
- `checkout/submit.ts:9` imports `payments/stripe.ts` directly. (needless link)
- `ui/SettingsDialog.tsx:61` sets a global `skipRefocus` flag so the logout dialog does not move focus. (hidden link)
- `refunds/refund.ts:22` wraps every Stripe call in `if (order.provider === "paypal")`. (special case)
- `ui/CommandPalette.tsx:55` keeps its own list of actions, and it is missing the newer ones. (hidden link)
```

Then each fix above the findings it solves. Each fix becomes one spec:

```md
- Make the general `Dialog` give focus back to whatever had it before it opened, so the wait and the flag can both go.
  - `ui/LogoutDialog.tsx:30` waits 100 ms after closing …
  - `ui/SettingsDialog.tsx:61` sets a global `skipRefocus` flag …
- Define a `PaymentProvider` that Stripe and PayPal both implement, so checkout and refunds no longer know which one they use.
  - `checkout/submit.ts:9` imports `payments/stripe.ts` directly.
  - `refunds/refund.ts:22` wraps every Stripe call in `if (order.provider === "paypal")`.
- Make every user action a command with a name and a handler, so the toolbar, menu and palette run from one list.
  - `ui/Toolbar.tsx:40` and `ui/Menu.tsx:22` …
  - `ui/CommandPalette.tsx:55` keeps its own list …
```

## Brief for a subagent

A subagent that reads part of the codebase gets:

- the folder or module it reads, and nothing outside it except to follow
  an import;
- the one question and the four kinds above, with their bullet lists;
- the instruction to change nothing and to return each finding as one
  line with a `file:line`, the kind, and what is there;
- the instruction to read both ends of every link it reports.

A subagent that checks the finished list gets the list and the fixes,
not the reasoning behind them, and returns findings that are not true
and places the list missed.
