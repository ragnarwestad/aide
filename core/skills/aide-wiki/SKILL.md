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

**Input:** $ARGUMENTS (the tracking key `wiki-<project>`; the project is
the current directory and the specs root is named in the prompt)

The wiki is the folder `wiki/` inside the specs root: `index.md`,
`schema.md` and one page per part of the system. Every write under
`wiki/` goes through `aide-wiki`, never through Write or Edit, and
nothing is written outside `wiki/`. The prompt names the specs root and
the project directory; pass them to every call as `--specs-root` and
`--project-dir`.

## Workflow

### Step 1: See what exists

Run `aide-wiki status --specs-root <root> --project-dir .`. A page whose
state is `hand-written` belongs to a person: its name is taken, and the
part it covers is linked to from other pages, not rewritten. Every other
page is rebuilt below.

### Step 2: Decide the parts

Read the project: its README, its layout, its own docs and its entry
points. A part is something with one job and its own vocabulary, not a
directory for its own sake. Aim for the pages a reader needs to place a
change: tens of pages for a large system, a handful for a small one.

### Step 3: Write a page for each part

For each part not covered by a hand-written page, pipe the page's body to
`aide-wiki write --specs-root <root> --project-dir . --page <name>.md
--file <path> [--file <path>...]`, naming the files and folders the page
was written from. The script adds the front matter with the mark and the
commit.

A page opens with a `# ` heading, then one line saying what the part does
(the index shows that line), then:

- who it talks to and over what, with ordinary markdown links to
  `other-page.md`
- what has to change along with it
- the words it uses for things

A page holds no line numbers and no code. It is a map: the code decides.

### Step 4: Finish

1. `aide-wiki schema --specs-root <root> --project-dir .`
2. `aide-wiki prune --specs-root <root> --keep <every page just written>`
3. `aide-wiki index --specs-root <root> --project-dir .` — last, so a run
   that stops early leaves the previous index in place.

Then report the pages written in one line each.
