---
name: aide-wiki
description: >-
  Build the project's wiki: a map of how its parts hang together, kept in
  the project's folder of the specs repository and read first by
  /aide-analyze. One page per part, an index and a schema, each generated
  page naming the files and the commit it was written from.
  Use when: the run is a wiki build (the runner starts it with
  --command wiki), by hand in a session, the wiki is missing or stale.
  Do NOT use for: a spec's analysis (use aide-analyze), documentation for
  readers of the project (use the project's own docs).
argument-hint: "[wiki-<project>] [refresh]"
effort: high
---

Build or rebuild the project's wiki, from the board or by hand in a
session. The run is headless when the prompt says so or `AIDE_HEADLESS`
is set: no one answers questions, so decide and finish. Otherwise someone
is there, and the skill asks only where a step below says so.

**Input:** $ARGUMENTS — from the board, the tracking key `wiki-<project>`,
then `refresh` when the run is a refresh; by hand, nothing for a build, or
`refresh`. A `refresh` among the arguments makes the run a refresh. The
project is the current directory.

A **build** rewrites every generated page from the code as it is now,
whether or not its files changed. A **refresh** rewrites only the pages
`aide-wiki status` marks `changed`, adds a page for a part that has none,
and leaves every current page as it is. The runner checks the result: a
build that leaves a page from an older commit, or a refresh that leaves a
`changed` page, ends unfinished. So does a build or a refresh that leaves
the project's overview or its reusable parts out: every wiki has
`overview.md` and `reusable-parts.md` beside its index, whatever its
parts, and a refresh writes the one `aide-wiki status` lists under
`missing`. By hand no runner checks the result, so Step 4 checks it by
the same rule.

The wiki is the folder `wiki/` inside the specs root: `index.md`,
`schema.md`, `overview.md`, `reusable-parts.md` and one page per part of
the system. Every write under
`wiki/` goes through `aide-wiki`, never through Write or Edit, and
nothing is written outside `wiki/`. Step 1 settles the specs root: the one
the prompt names, or by hand the one it finds. Pass it, and the project
directory, to every call as `--specs-root` and `--project-dir`.

## Workflow

The steps below are this skill's own, inside the queue's `wiki` step.
Mark each one in the log, so a reader can follow the run: when it
starts, write one line `--- Step N of X: <title> — started`, and when
it ends, one line `--- Step N of X: <title> — done`. A step that ends
the run early says `— stopped: <why>` in place of `— done`, and one that does not apply to this run `— skipped: <why>`.

Step 5, the merge into the default branch, is Aide's, after this
session: Aide writes its marks, and the wiki is finished only when it is
done.

### Step 1 of 5: See what exists

First write `--- Step 1 of 5: See what exists — started`, and when this step ends, `--- Step 1 of 5: See what exists — done`.


A board run's prompt names the specs root and the project directory: use
exactly those, and look nothing up. By hand, find the specs root the way
the other skills do: `AIDE_SPECS_PATH` in `.aide/config` in the project
root, or `specs/` in the project root when the file names none
(`aide_specs_root` in `_aide-spec-lib.sh` does the whole lookup), then
`git pull --ff-only` the repository that holds it; when that cannot
fast-forward, say so and go on from what is on disk.

Run `aide-wiki status --specs-root <root> --project-dir .`. A page whose
state is `hand-written` belongs to a person: its name is taken, and the
part it covers is linked to from other pages, not rewritten. In a build,
every other page is rebuilt below; in a refresh, only the `changed` ones
are, and Step 2 is only about whether a new part needs a page of its own.
The answer's `missing` lists the pages every wiki must have and this one
lacks (`overview.md`, `reusable-parts.md`); a build and a refresh both
write each of them in Step 3.

### Step 2 of 5: Decide the parts

First write `--- Step 2 of 5: Decide the parts — started`, and when this step ends, `--- Step 2 of 5: Decide the parts — done`.


Read the project: its README, its layout, its own docs and its entry
points. A part is something with one job and its own vocabulary, not a
directory for its own sake. Aim for the pages a reader needs to place a
change: tens of pages for a large system, a handful for a small one.

A part is small enough when a change to it names its files from the page
alone. A user interface is not one part: each page or surface a user
sees — a list, a detail page and its tabs, a dialog, the stylesheets — is
a part of its own, since that is where changes land. The test of a split:
given a change described in the user's words, the index points at one
page, and that page names the files the change will touch.

By hand, ask before Step 3 writes anything when this does not settle how
the project divides: two divisions both pass the test of a split and send
the same change to different pages, or a part's job is not plain from its
code and docs. Name the parts you propose and what is unclear, and wait for
the answer. In a refresh this concerns only a new part: a page of its own,
or a place on an existing one. Otherwise decide without asking, as a
headless run always does; nothing else is asked before Step 4's commit
question.

### Step 3 of 5: Write a page for each part

First write `--- Step 3 of 5: Write a page for each part — started`, and when this step ends, `--- Step 3 of 5: Write a page for each part — done`.


For each part not covered by a hand-written page, pipe the page's body to
`aide-wiki write --specs-root <root> --project-dir . --page <name>.md --file <path> [--file <path>...]`,
naming the files the page was written
from. Files, never folders — the script refuses a folder, since a page
written from one reads as stale whenever anything in it changes. Name the
files that carry the part: its entry points, its types, the doc page that
describes it — not everything in its folder. The script adds the front
matter with the mark and the commit.

A page opens with a `# ` heading, then one line saying what the part does
(the index shows that line), then:

- its pieces, one line each, naming the file that holds the piece by its
  full path from the project's root, in backticks:
  "`dashboard/src/specs-client/deploy/run.ts` runs the Deploy dialog's
  steps", never a piece named with no file behind it. Every file the
  text names this way becomes one of the page's sources, so a page that
  mentions a stylesheet goes stale when that stylesheet changes
- a link to the page of every shared component it uses (a control, a
  dialog, the stylesheets), so a change placed on this page finds what
  it shares with others

- who it talks to and over what, with ordinary markdown links to
  `other-page.md`
- what has to change along with it: one line per ripple, in the form
  "change X, and Y must follow, because …", naming files or pages. A
  pointer to another document is not a ripple; if that document lists
  one, say it here
- the words it uses for things

A page holds no line numbers and no code. It is a map: the code decides.

Keep a reason only when it still explains the current code, as one ripple
sentence in the page it concerns.

Then write the two pages every wiki has, whatever its parts. Each is a
generated page like the others, written with `aide-wiki write`, and the
script refuses it without its sections, heading for heading:

- `overview.md` — what the analysis takes the project's context from.
  `## Stack` (languages, frameworks, runtime), `## Services` (the
  external services it depends on and what for; say so when there are
  none), `## Build and deploy` (how it is built, tested and shipped) and
  `## Docs` (each doc page and what it covers). Other sections may follow.
- `reusable-parts.md` — what the analysis looks for before it plans new
  code. `## Parts` (each part worth reusing: its job, in one line, and
  the file that holds it, in backticks) and `## Rules` (the rules for
  using them: what to call, what never to copy). Say so when there is
  nothing to reuse. Other sections may follow.

Both name in backticks, by full path from the project's root, the files
they were drawn from — the package and build files, the CI and deploy
configuration, each doc page, each reusable part's file — since a page
is rewritten by a refresh when one of them changes.

### Step 4 of 5: Finish

First write `--- Step 4 of 5: Finish — started`, and when this step ends, `--- Step 4 of 5: Finish — done`.

In a headless run nothing of this is on the default branch yet: the
wiki is finished only once Step 5, the merge into main, is done. So the
report's first line ends `— not finished, the merge into main is next
(Step 5)`, and the report never calls the wiki done or complete.


1. `aide-wiki schema --specs-root <root> --project-dir .`
2. `aide-wiki prune --specs-root <root> --project-dir . --keep <every page just written, `overview.md` and `reusable-parts.md` included>`,
   and in a refresh every current page too: only a page whose part is gone
   goes.
3. `aide-wiki index --specs-root <root> --project-dir .` — last, so a run
   that stops early leaves the previous index in place.

4. By hand, check the result the way the runner checks a board run:
   `aide-wiki unfinished --specs-root <root> --project-dir .`, with
   `--refresh` in a refresh. Its `pages` are the generated pages a build
   left from an older commit, or the `changed` pages a refresh left;
   `missing` the fixed pages the wiki lacks; `index` is false when there is
   no index. Whatever it names is unfinished.

Then report the pages written in one line each, and the pages prune
deleted. By hand there is no merge step: the report's first line says the
wiki is built or refreshed, or that it is not finished, naming what the
check named.

By hand, end by asking whether to commit the wiki's changes in the specs
repository, the repository that holds the specs root, and suggest this
message:

```text
Run /aide-wiki for wiki-<project> (model: <tool> <model>)
```

`<project>` is the name of the project root's folder, the name the board
gives the project. Add the `(model: ...)` part only when you can name your
own model with certainty. A yes commits the wiki folder alone, removed
pages included, so nothing else staged or changed goes with it:
`git -C <root> add -- wiki`, then
`git -C <root> commit -m "<message>" -- wiki`. Nothing is pushed or
merged; that is the person's. Without a yes nothing is committed. When
`git -C <root> status --porcelain -- wiki` shows nothing, or the specs
root is in no repository, or its repository ignores it, say so in place of
the question.

A headless run asks nothing about committing: the runner commits what the
session leaves, and merges it.

### Step 5 of 5: Merge into main

Aide writes `--- Step 5 of 5: Merge into main — started` itself, after this session, and ends it `— done` or `— stopped: <why>`.

Not this session's step, and it writes no mark for it. In a headless
run Aide merges what this session committed on the spec's branch into
the default branch once the session has ended, and the wiki is finished
when that merge is, not before. Working interactively there is no such
step: the steps above say what reaches the default branch.
