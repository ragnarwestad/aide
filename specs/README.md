# Specs

## Table of contents

- [What this folder is](#what-this-folder-is)
- [A spec's files](#a-specs-files)
- [How a spec is made and run](#how-a-spec-is-made-and-run)

---

## What this folder is

Where a project keeps its specs, unless `AIDE_SPECS_PATH` in its `.aide/config` names another place. This
repository's own specs are kept in the separate `aide-specs` repository, so `specs/` is gitignored here and this page
is the only file tracked in it.

## A spec's files

Each spec is a folder, `<NN>-slug/`, holding `0-README.md` and four files: `1-description.md` (the problem),
`2-analysis.md` (what the code shows), `3-solution.md` (the plan, test first) and `4-status.md` (progress). A spec
that is archived or closed moves to `archive/`. The layout in full is in
[the spec-structure skill](../core/skills/spec-structure/SKILL.md).

## How a spec is made and run

A spec's steps — create, analyze, implement, archive, close and reopen — run only on the board. Start them from the
dashboard, or with the `aide` command (`aide --help`).
