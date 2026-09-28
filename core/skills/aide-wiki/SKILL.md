---
name: aide-wiki
description: >-
  Build the project's wiki: a map of how its parts hang together, kept in
  the project's folder of the specs repository and read first by
  /aide-analyze. One page per part, an index and a schema, each generated
  page naming the files and the commit it was written from.
  Use when: the run is a wiki build (the runner starts it with
  --command wiki), the wiki is missing or stale.
  Do NOT use for: a spec's analysis (use aide-analyze), documentation for
  readers of the project (use the project's own docs).
argument-hint: "wiki-<project>"
effort: high
---

Build or rebuild the project's wiki. The run is headless: no one answers
questions, so decide and finish.

**Input:** $ARGUMENTS (the tracking key `wiki-<project>`, then `refresh`
when the run is a refresh; the project is the current directory and the
specs root is named in the prompt)

A **build** rewrites every generated page from the code as it is now,
whether or not its files changed. A **refresh** rewrites only the pages
`aide-wiki status` marks `changed`, adds a page for a part that has none,
and leaves every current page as it is. The runner checks the result: a
build that leaves a page from an older commit, or a refresh that leaves a
`changed` page, ends unfinished.

The wiki is the folder `wiki/` inside the specs root: `index.md`,
`schema.md` and one page per part of the system. Every write under
`wiki/` goes through `aide-wiki`, never through Write or Edit, and
nothing is written outside `wiki/`. The prompt names the specs root and
the project directory; pass them to every call as `--specs-root` and
`--project-dir`.

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


Run `aide-wiki status --specs-root <root> --project-dir .`. A page whose
state is `hand-written` belongs to a person: its name is taken, and the
part it covers is linked to from other pages, not rewritten. A decision
page (`wiki: decision`) is such a page too, whoever wrote it: it is never
rewritten, and `aide-wiki index` lists it under its own heading. In a build,
every other page is rebuilt below; in a refresh, only the `changed` ones
are, and Step 2 is only about whether a new part needs a page of its own.

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

A page a decision concerns ends with a `## Decisions` section that the
script writes on every `aide-wiki write`. Leave it out of the body you
pipe in.

### Step 4 of 5: Finish

First write `--- Step 4 of 5: Finish — started`, and when this step ends, `--- Step 4 of 5: Finish — done`.

In a headless run nothing of this is on the default branch yet: the
wiki is finished only once Step 5, the merge into main, is done. So the
report's first line ends `— not finished, the merge into main is next
(Step 5)`, and the report never calls the wiki done or complete.


1. `aide-wiki schema --specs-root <root> --project-dir .`
2. `aide-wiki prune --specs-root <root> --keep <every page just written>`,
   and in a refresh every current page too: only a page whose part is gone
   goes
3. `aide-wiki index --specs-root <root> --project-dir .` — last, so a run
   that stops early leaves the previous index in place.

Then report the pages written in one line each.

### Step 5 of 5: Merge into main

Aide writes `--- Step 5 of 5: Merge into main — started` itself, after this session, and ends it `— done` or `— stopped: <why>`.

Not this session's step, and it writes no mark for it. In a headless
run Aide merges what this session committed on the spec's branch into
the default branch once the session has ended, and the wiki is finished
when that merge is, not before. Working interactively there is no such
step: the steps above say what reaches the default branch.
