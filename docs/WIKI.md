# The project wiki

## Table of contents

- [What it is](#what-it-is)
- [Where the idea comes from](#where-the-idea-comes-from)
- [What is in it](#what-is-in-it)
- [Who writes it](#who-writes-it)
- [Who reads it](#who-reads-it)
- [How a page is known to be current](#how-a-page-is-known-to-be-current)
- [Where the details are](#where-the-details-are)

---

## What it is

A project can have a wiki: one page per part of the system, saying what the part does, who it talks to, what has to
change along with it, and the words it uses. It lives in `wiki/` in the project's folder of the specs repository.

Without it, every analysis starts from nothing: it searches the code to find out how the parts hang together, and the
next spec searches for the same things again. The wiki keeps what one run works out for the next. A page holds what
changes seldom; line numbers and code detail stay in the code.

## Where the idea comes from

It follows the pattern Andrej Karpathy described in his post
[LLM Knowledge Bases](https://x.com/karpathy/status/2039805659525644595) on X in April 2026, and wrote up afterwards
as the [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): a knowledge base an AI writes once
and keeps current, with an index and a schema, instead of finding the same things
again on every question. Aide applies it to a code base, and adds what the pattern leaves open: each page names the
files and the commit it was written from, so a reader can tell whether the code has moved on.

## What is in it

- **`index.md`:** one line per page, read first.
- **A schema page:** how the wiki is organised and what a page must contain.
- **`overview.md`:** the project's stack, the services it depends on, how it is built and deployed, and its docs.
- **`reusable-parts.md`:** the parts worth reusing, with the file that holds each, and the rules for using them.
  Both are generated pages like the rest, and `aide-wiki write` refuses either without its sections.
- **One page per part:** written from the files it names, with ordinary markdown links to the pages it relates to.
  A generated page records its files and commit; a page written by hand is never rewritten.

## Who writes it

- **A build**, from the **Build wiki** button on the project's Wiki tab: the `wiki` step with the `aide-wiki` skill,
  rewriting every generated page from the code as it is now. It lands like a spec.
- **The archive of a spec** rewrites the pages the spec's own code touched (`aide-archive`, Step 2). A guard refuses an
  archive that changed any other page.
- **A refresh**, queued by the board once an archive lands in a project with a wiki: the same step, rewriting only the
  pages whose files changed since they were written, and adding a page for a new part or for either fixed page the
  wiki lacks.
- **A run by hand**, `/aide-wiki` or `/aide-wiki refresh` in a session in the project, without the board. It finds the
  specs root the way the other skills do, asks only when it is unclear how the project divides into pages, checks its
  own result with `aide-wiki unfinished` by the rule the runner applies to a board run, and asks before it commits the
  wiki folder in the specs repository. It never pushes or merges.
- **A scheduled job**, where a project sets one up on its Schedule tab. Aide's own board runs a refresh every night
  (`docs/prompts/wiki-refresh.md`) and a weekly check that reports pages the code or docs contradict, and changes
  nothing (`docs/prompts/wiki-check.md`).

## Who reads it

- **Analyze**, before anything else: the index, the overview and the reusable parts, then the pages that concern the
  change, and the analysis says which pages it used and whether their files had changed. A page whose files have changed is used only as a map of where
  to look; the code decides.
- **People**, on the project's Wiki tab, which lists the pages in the index's order with the state of each, and opens
  one rendered.

In a project with a wiki, the analysis takes the project's context and reusable parts from the overview and the
reusable-parts page, not from `.aide/project.yaml`. A project with no wiki is analysed from the manifest.

## How a page is known to be current

`aide-wiki status` compares each generated page's files with the project as it is now, and gives each page a state,
the same the Wiki tab shows:

- **Current:** none of its files has changed since the commit it was written from.
- **Files changed:** a file it names differs from that commit.
- **Unknown:** the commit is not in the project's checkout.
- **By hand:** a page written by hand, whose freshness is not tracked.

## Where the details are

- The Wiki tab: [projects.md, "Wiki"](../dashboard/docs/projects.md#wiki).
- How a build and a refresh write the pages: `core/skills/aide-wiki/SKILL.md`.
- How an archive rewrites the pages it touched: `core/skills/aide-archive/SKILL.md`, Step 2.
- How analyze reads the wiki: `core/skills/aide-analyze/SKILL.md`, Step 1.
- What a `wiki` step may commit, and the guard on an archive's pages: [the-runner.md](../dashboard/docs/the-runner.md).
- The graph of the pages: [design-system.md, "The wiki graph"](../dashboard/docs/design-system.md#the-wiki-graph).
