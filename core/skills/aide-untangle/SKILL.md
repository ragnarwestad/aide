---
name: aide-untangle
description: >-
  Map where a codebase is tangled — pieces that must change together but do
  not show it, pieces tied together that change for different reasons, code
  with no reason of its own to exist, special cases — and where it breaks the
  project's size limits (lines per file, files per folder). Changes nothing:
  every fix comes out as spec text, one spec per fix.
  Use when: "untangle", "kartlegg koden", "hvor er koden floket",
  "finn duplisert logikk", "sjekk filstørrelser", before a refactor, when
  agents keep missing a place a change has to touch.
  Do NOT use for: making the changes (each spec goes through aide-analyze and
  aide-implement), reviewing a diff (use code-review), exploring an idea
  (use aide-explore).
argument-hint: "[optional area or concern to focus on]"
effort: high
---

# Untangle a codebase

Find every place the code answers one question wrong — **should these
pieces change together?** — and every file or folder over the project's
size limits, and hand each fix over as spec text. The output is a map and
a list of specs; the code is left exactly as it was.

**Input:** $ARGUMENTS (an area or a concern to start from, or nothing for
the whole codebase)

## Ground rules

- **Change nothing.** No code, no tests, no docs, no specs, no git. Reading,
  searching and running read-only scripts (a line count, an import graph,
  `git log`) is allowed and expected. A fix that looks obvious is still
  written down, not made: it goes through a spec, where it gets an
  analysis, tests and a review.
- **Every finding has a `file:line`.** A finding without one cannot be
  checked, and a spec built on it starts with a guess.
- **Verify before you write it down.** Open the file and read the lines.
  A finding a search suggested and nobody read is the most common wrong
  finding (see Pitfalls).

## Workflow

### Step 1: Agree on the area

Whole codebase, or the area in `$ARGUMENTS`. For more than a few hundred
files, say how you will split the reading (by top-level folder, by
module) and how long it will take, before you start. Subagents may read
parts in parallel; each one gets the brief in
[references/method.md](references/method.md), "Brief for a subagent",
and returns findings with `file:line`, never edits.

### Step 2: Check the size limits

The project's own limits win when it states them (its CLAUDE.md,
AGENTS.md or a code-health test). Otherwise use these:

| Limit                                           | Default |
| ----------------------------------------------- | ------- |
| Lines in a source file                          | 500     |
| Lines in a test file                            | 800     |
| Source or test files directly inside one folder | 15      |

Markdown is left out. A language's established layout wins where it
meets these limits (a flat folder of commands on PATH, Python packages).
Count with a script, not by eye — see
[references/method.md](references/method.md), "Counting". Each file or
folder over a limit is a finding; the fix is a split by responsibility —
name the part that has its own name — never an arbitrary half.

### Step 3: List every problem

Still change nothing. Read the area asking one question of each piece:
should it change together with the pieces it is tied to? Write down every
place the answer is wrong, in the three kinds and the special cases
[references/method.md](references/method.md) lists. Its "Reading a large
codebase" has the ways in (a skeleton, an import graph, what git shows
changing together):

- **Hidden links** — must change together, and nothing shows it.
- **Needless links** — tied together, change for different reasons.
- **Surplus** — no reason of its own to change.
- **Special cases** — code that exists for one situation instead of
  following from how the system works.

One line per finding: the `file:line`, what is there, and why it is one
of the four. Keep the list in a decision log
([references/method.md](references/method.md), "Decision log") so a long
session survives compaction.

### Step 4: Find the fixes

Work out each fix as if the system had known today's requirements from
the start. Look for the one fix behind several findings — it often looks
nothing like them. Write each fix above the findings it solves. A fix
must leave pieces that change together together, pieces that do not
untied, and everything depending on what changes less. Prefer the fix
that deepens a module: more behind a smaller interface, so its callers
know less and change less.

Leave out a fix that costs more than the problem: say so in one line, and
keep the finding on the list.

### Step 5: Check the list

Have a subagent read the findings and the fixes without your reasoning,
and look for what you missed and for findings that are not true. Drop a
finding you cannot show with a `file:line`.

### Step 6: Hand over the specs

One spec per fix, in the format of the `spec-handover` skill: load it
first. Order them so that a spec that makes another one smaller comes
first, and name that in Avhengigheter. Each spec's `## Problem` names
its findings with `file:line`; its acceptance criteria say what holds
after the fix, never how the code is laid out. Create none of them:
creating a spec is the user's call, and the `spec-handover` skill says
how it is done when the user asks.

End with a short summary: how many findings of each kind, how many
specs, and which one you would start with and why.

## Pitfalls

- **A finding from search alone.** A grep shows two functions with the
  same name; reading them shows they do different things. Read both ends
  of every "copy" before calling it one.
- **A layout opinion dressed as a finding.** "This folder should be
  called X" is not a tangle. A finding names what breaks, or what has to
  change in several places, when the code changes.
- **Fixing special cases one by one.** Ten `if`s for ten values are one
  finding about a missing concept, not ten specs.
- **A split that only moves lines.** A 600-line file cut into two files
  that import each other everywhere is still one module. Split where a
  part has its own name and its own reason to change.
- **Writing the fix into the code "because it was small".** This skill
  changes nothing. A fix made here skips the tests and review a spec
  gives it.

## Related skills

- `spec-handover` — the format each fix is handed over in
- `aide-explore` — when a fix needs thinking through before it is a spec
- `aide-analyze` — what each spec goes through next
