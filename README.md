# <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/aide-wordmark-dark.svg"><img src="docs/assets/aide-wordmark-light.svg" alt="Aide" height="40"></picture>

Spec-driven development for AI CLIs: every change starts as a spec, and a dashboard runs it through analysis,
implementation and archiving.

## Table of contents

- [What Aide is](#what-aide-is)
- [What a spec looks like](#what-a-spec-looks-like)
- [Where Aide sits in spec-driven development](#where-aide-sits-in-spec-driven-development)
- [The aide-* skills](#the-aide--skills)
- [Install & Configuration](#install--configuration)
    - [Per-project configuration](#per-project-configuration)
- [The workflow, step by step](#the-workflow-step-by-step)
- [The Aide dashboard](#the-aide-dashboard)
- [Resources](#resources)

---

## What Aide is

Aide is a tool for spec-driven development: before an AI CLI writes code, it writes a specification — four
plain-Markdown files (description, analysis, solution, status) that you and any AI CLI can read, review and
continue identically. The spec is committed to git, either in the project it describes or in a specs repository of
its own.

### The skills

Each step of the workflow — create, analyze, implement and archive — is an `aide-*` skill: a command you type in
Claude Code, Codex, OpenCode or GitHub Copilot, one spec at a time, and follow as it works.
See [The aide-\* skills](#the-aide--skills).

### The dashboard

The dashboard is a local web application. You install it on one machine — your own, or one that is always on — and
open it in a browser at `http://127.0.0.1:8788`. It lists every spec in every project Aide knows about, and runs
the skills itself: you queue a spec, and it runs create, analyze, implement and archive in order, on the AI CLI
and model chosen for each step, several specs at a time. It records each step's cost, token count and outcome, and
holds a spec before archive until you have ticked its acceptance criteria.
See [The Aide dashboard](#the-aide-dashboard).

### Aide is a personal tool

It is installed for one user on one machine, and the dashboard has no sign-in and no notion of who is using it:
every run uses the AI account of the user it runs as. Nothing has to be committed to a project for Aide to work on
it, which is what makes it usable on a repository someone else owns.

### It works with four AI CLIs

Claude Code, Codex, OpenCode and Copilot read and continue the same spec, so each step can run on whichever tool
suits it, and the spec is what carries the work between them.

### What the spec is for

Requirements that live only in a chat history disappear with it: the reasoning behind a decision is gone, the next
session starts from zero, and you cannot go back and see what was agreed before the code was written. The spec
holds what the chat loses — the affected files with their line numbers, the plan written before the code, and a
record of what each step did — reviewable as a diff before a line of code changes, and still there a month later.

---

## What a spec looks like

A spec is a folder of four files:

- `1-description.md` — what is wrong and what done means. The user writes it, or has `/aide-create` draft it from a
  title and a few sentences
- `2-analysis.md` — what analyze found in the codebase
- `3-solution.md` — the plan analyze writes for implement to follow
- `4-status.md` — where every step records its progress

This is an archived spec from Aide's own work, shortened where it says `[...]`.

From `1-description.md`:

```markdown
# A spec's row offers a test server only where one can run - Description

## Problem

When a spec's archive is held back on unticked acceptance criteria, its row on the specs list adds "Test server:
click the link to start a test server running this branch". [...] The spec page already checks that before it shows
the start button; the row does not, so a spec in [another project] gets a link that leads to the "this project's own
checkout does not carry the dashboard's source" page.

## Acceptance criteria

- **AC-1:** For a spec held back on unticked acceptance criteria, belonging to a project whose checkout carries the
  dashboard's source, the row SHALL show the held-back mark together with a link to start a test server.
- **AC-2:** [...] belonging to a project whose checkout does NOT carry the dashboard's source, the row SHALL show the
  held-back mark alone, with no test-server link.
- **AC-3:** The row's decision of whether the project can run a test server SHALL use the same per-project check the
  spec page already uses, not a separate or duplicated check.
```

`4-status.md` records what ran, and ends with the criteria as rows that only a user ticks. Archive waits until
every row is ticked:

```markdown
- **Result:** completed
- **Workflow steps completed:** create, analyze, implement, archive

## Acceptance criteria

| Task                                                              | Status | Notes |
|-------------------------------------------------------------------|--------|-------|
| AC-1: For a spec held back on unticked acceptance criteria, [...] | ✅      |       |
| AC-2: For a spec held back on unticked acceptance criteria, [...] | ✅      |       |
| AC-3: The row's decision of whether the project can run [...]     | ✅      |       |
```

---

## Where Aide sits in spec-driven development

Spec-driven development means writing a spec before an AI tool writes code, and treating that spec as the source
of truth for what gets built. Birgitta Böckeler's
[Understanding Spec-Driven-Development](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) names
three levels of it:

| Level          | The spec …                                                                      |
|----------------|---------------------------------------------------------------------------------|
| Spec-first     | is written first and guides the work, then is discarded once the feature exists |
| Spec-anchored  | is kept after the work and edited as the feature evolves                        |
| Spec-as-source | is the only thing a user edits; the code is generated from it                   |

Aide is spec-anchored. The spec is what you edit when the result is not what you wanted: you add or reword
acceptance criteria, and run the same spec through analysis or implementation again. That is also what lets
another round start — at least one criterion that is still unticked has to be new or reworded since the previous
round. When every criterion is ticked, the spec is archived: it moves to `archive/` and keeps all four files. The
archive step also writes what the change means for the project into the project's own documentation. An archived
spec can be reopened later and taken through another round. It is not spec-as-source: you and the AI CLI still
read and edit the code.

[docs/COMPARISON.md](docs/COMPARISON.md) puts the other spec-driven tools through the same criteria: document
structure, which AI tools they run on, how they execute a step, what they do with the code, and what each one
leaves behind in a repository.

---

## The aide-\* skills

Once Aide is installed, a skill is a slash command you type in your AI CLI — Claude Code, Codex, OpenCode or
Copilot. It takes the spec's number: `/aide-analyze 55`. The dashboard runs the four workflow skills for you
instead of you typing them, one after the other — see [The workflow, step by step](#the-workflow-step-by-step) and
[The Aide dashboard](#the-aide-dashboard).

The four workflow skills, in the order a spec moves through them:

| Skill             | What it does                                                                                                                                                          |
|-------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `/aide-create`    | Creates the spec's folder and its four files from a title and a description                                                                                           |
| `/aide-analyze`   | Grades the change LOW, MEDIUM or HIGH and scales the analysis to that grade, maps the affected files with file:line references, and writes the plan implement follows |
| `/aide-implement` | Writes the code test-first (RED → GREEN → REFACTOR), following the analysis and the plan                                                                              |
| `/aide-archive`   | Archives a finished spec, resolves any merge conflict with the default branch, and writes what the change means for the project into the project's own documentation  |

The other skills:

| Skill            | What it does                                                                                                                                                           |
|------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `/aide-explore`  | Weighs approaches and sharpens the scope before a spec is created; creates no files                                                                                    |
| `/aide-manifest` | Drafts or refreshes a project's `.aide/project.yaml` manifest (stack, dependencies, deployment, docs)                                                                  |
| `/aide-wiki`     | Builds a project's wiki: one page per part of the system, an index and a schema, kept in the specs repository and read first by `/aide-analyze`                        |
| `/aide-close`    | Closes a spec you have decided not to build: records the reason, moves it to `archive/`, and deletes its code branch unmerged                                          |
| `/aide-reopen`   | Takes an archived spec back into the active list for another round of analysis or implementation; keeps every file unless asked to reset the analysis, plan and status |
| `/aide-to-pdf`   | Generates a PDF from a spec's documentation                                                                                                                            |

---

## Install & Configuration

Install these first — Aide checks for them and installs none of them:

```bash
curl https://mise.run | sh              # mise, then follow its own instructions for your shell
mise use -g node@lts                    # a node, which the tools Aide declares are installed with
curl -fsSL https://claude.ai/install.sh | bash   # the AI CLI you will use, here Claude Code
```

Then clone the repo and run the installer. It sets up Aide's skills for all four AI CLIs, and names the command
for anything on that list it cannot find. Nothing is installed into the project you will use Aide on — the skills
go in your home directory, and any project can then use them.

```bash
git clone https://github.com/ragnarwestad/aide.git
cd aide && ./install-all.sh
```

The installer adds a PATH line to your shell's startup file, so open a new terminal before the next step. Signing
in to Claude Code is left to you, and is done once:

```bash
claude    # sign in, then /exit
```

No AI CLI is installed for you. Each tool's installer sets up Aide's skills and configuration for it and says so
when the tool itself is missing, so install the ones you want to use yourself.

[mise](https://mise.jdx.dev) is what `install-all.sh` uses to install the tools the skills and scripts call: bun,
jq, gh, pandoc and md-to-pdf.

`./install-all.sh` runs all four installers and asks nothing. The only questions any of them has are Codex's two
optional MCP servers — browser testing and Context7 — and run from here, both are answered no. To be asked them,
or to install for one tool only, run that tool's installer on its own:

| AI CLI         | Install                                  | Documentation                                        |
|----------------|------------------------------------------|------------------------------------------------------|
| Claude Code    | `implementations/claude-code/install.sh` | [INSTALL.md](implementations/claude-code/INSTALL.md) |
| GitHub Copilot | `implementations/copilot/install.sh`     | [INSTALL.md](implementations/copilot/INSTALL.md)     |
| Codex          | `implementations/codex/install.sh`       | [README.md](implementations/codex/README.md)         |
| OpenCode       | `implementations/opencode/install.sh`    | [README.md](implementations/opencode/README.md)      |

The dashboard is installed afterwards, on the one machine that will run it, and serves at
`http://127.0.0.1:8788`. On macOS that is `dashboard/install.sh`, which sets it up as a service that starts when
you log in. On Linux there is no such service, and `install.sh` refuses: `dashboard/serve.sh` runs the dashboard
in a terminal instead. Either way the dashboard starts every step through Aide's own scripts and skills, so run
`./install-all.sh` on that machine too. See
[Requirements in the dashboard's README](dashboard/README.md#requirements) for what else it needs.

Aide runs on macOS and Linux, and the Linux install is tested end to end on a clean Debian. On Windows it runs
inside [WSL](https://learn.microsoft.com/en-us/windows/wsl/install), which is Linux; Git Bash is not enough.

### Per-project configuration

**`AIDE_SPECS_PATH`** stores a project's specs outside the project. Set it in `.aide/config` in the project's
root:

```text
AIDE_SPECS_PATH=/Users/you/develop/my-specs-repo
```

Without it, specs are written to `specs/` in the project root. Where several projects share one specs repo, give
each its own subfolder (`my-specs-repo/<project>/`): each then keeps its own number sequence and its own
`archive/`. Point them all at the repo root and they share one sequence, so a spec's number no longer tells you
which project it belongs to.

`.aide/config` holds one machine's own settings for that project, and is not meant to be committed — a personal
global gitignore (`core.excludesFile`) keeps it out without touching the project's own `.gitignore`. The other
file, `.aide/project.yaml`, describes the project itself: the command that runs its tests, the directories a run
needs that git does not track (`node_modules`, `.env` and the like), and whether its code is merged or left open
as a pull request. It does not have to be there at all — the dashboard keeps those settings in its own state,
outside the project — and the dashboard writes the file only in a project that already tracks one.

---

## The workflow, step by step

```text
   (/aide-explore — optional, before a spec exists)

1. CREATE
   ↓
2. ANALYZE
   ↓
3. IMPLEMENT — ends when the project's own test suite runs green
   ↓
4. ARCHIVE — the spec moves to archive/, and the code is merged into the default branch
```

Run by hand, that is four commands in your AI CLI, in the project's directory. `/aide-create` takes a quoted title
and then the description, and reports the number it gave the spec — 55 here. The three later commands take that
number:

```text
/aide-create "Move the forms off Redux Form" The forms still use Redux Form, which is unmaintained. Move them to React Hook Form, one form at a time, keeping the validation rules.
/aide-analyze 55      # writes 2-analysis.md and 3-solution.md
/aide-implement 55    # writes the tests and the code
/aide-archive 55      # moves the spec to archive/, and lands the code
```

Nothing pauses between analyze and implement, so read the plan in `3-solution.md` before you start implement. That
is where a wrong plan is cheapest to change.

A red test run goes back to the same session to be fixed, twice. Still red after that, and implement fails with
the failing tests reported; what fixes it is another implement round, not a retry of the same one.

On the dashboard you type none of this. A spec that already exists has a row: tick the phases to run under
**Select**, pick the AI and the model, and press **Run**. A spec that does not exist yet is written on the New
spec form, which queues create and the phases after it.

**See:** [dashboard/docs/spec-lifecycle.md](dashboard/docs/spec-lifecycle.md) — the same four steps, which the
dashboard calls phases, and what moves a spec from one to the next.

---

## The Aide dashboard

You add a project on the dashboard's Projects page. It clones the project into its own directory, keeps that
clone to itself, and lists every spec it finds there — a directory under its projects root counts as a project
when the dashboard holds settings for it, or when it has a `.aide/project.yaml` of its own. Each spec's phase is
read from its `4-status.md`, so no list of specs is maintained anywhere.

What the dashboard does that the skills alone do not:

- **Every spec in one list** — every project it knows of in one table, with search and a filter for active or
  archived
- **Runs you do not have to sit through** — you queue a spec, and create, analyze, implement and archive run one
  after the other, several specs at a time
- **A choice of CLI and model per phase** — made in advance, on the spec's row, rather than by opening a
  particular terminal
- **Live progress** — the row shows the phase running now, how long it has been running and what it has spent
- **Dependencies** — a spec can name another spec it depends on: its implement and archive then wait until that
  spec is archived, while create and analyze run as usual
- **Archive waits for you** — a spec with acceptance criteria is held before archive until you have ticked every
  row on its Status tab and pressed Archive
- **Another round keeps your ticks** — correct the description and the criteria, run analyze and implement again,
  and the rows you had already ticked stay ticked
  (see [Another round on the same spec](dashboard/docs/spec-lifecycle.md#another-round-on-the-same-spec))
- **The merge** — the spec's branch is merged into the default branch once the project's tests pass on the
  merged result, or left open as a pull request
  (see [How a project's code lands](dashboard/docs/projects.md#how-a-projects-code-lands))
- **Every job that has run** — a spec's page holds its four files and the record of each job run against it,
  with what it cost

<!--suppress HtmlDeprecatedAttribute, CheckImageSize -->
<p align="center"><img src="docs/assets/aide-board-specs-list.png" alt="The specs list on the Aide dashboard" width="50%"></p>

<!--suppress HtmlDeprecatedAttribute -->
<p align="center"><em>The specs list: the phase each spec has reached, what is running now, and the controls that
start the next phase.</em></p>

It lives in `dashboard/` and has its own documentation: **[dashboard/README.md](dashboard/README.md)**.

---

## Resources

About Aide:

- [How Aide compares with the other spec-driven tools](docs/COMPARISON.md) — Kiro, Spec Kit, BMAD, GSD, OpenSpec,
  Tessl, Cursor's Plan Mode and Augment Code, each answered on the same criteria

Reading:

- [Understanding Spec-Driven-Development](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) —
  Birgitta Böckeler on the three levels of spec-driven development and the tools behind them
- [Spec-driven development with AI](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)
  — GitHub's own introduction to Spec Kit
- [Anioko/spec-driven-development](https://github.com/Anioko/spec-driven-development) — a guide to the maturity
  levels of spec-driven development, and when a spec compiler fits better than an agent workflow

The tools themselves, for the ones compared above that publish their own documentation:

- [GitHub Spec Kit](https://github.com/github/spec-kit)
- [OpenSpec](https://github.com/Fission-AI/OpenSpec)
- [Kiro](https://kiro.dev)
- [Tessl](https://tessl.io/)
