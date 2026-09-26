# Comparison with other spec-driven tools

Aide and the other tools for spec-driven development — writing down what is to be built, and how, before an AI
writes the code — compared on the same seven criteria. The criteria are defined first, five
of them are summarised in a table, and then all seven are answered one tool at a time. The last chapter lists Aide's own design
choices with the advantages and disadvantages of each.

Every description of another tool comes from that tool's own documentation, linked in its entry. Where a document
does not state something, the entry says so rather than guessing.

## Table of contents

- [The criteria](#the-criteria)
- [Summary](#summary)
- [Aide](#aide)
- [OpenSpec](#openspec)
- [GitHub Spec Kit](#github-spec-kit)
- [AWS Kiro](#aws-kiro)
- [BMAD-METHOD](#bmad-method)
- [GSD (Get Shit Done)](#gsd-get-shit-done)
- [Tessl](#tessl)
- [Cursor's Plan Mode](#cursors-plan-mode)
- [Augment Code](#augment-code)
- [Aide's design choices](#aides-design-choices)

---

## The criteria

**What it is.** The kind of tool: commands that run inside an AI CLI, an editor or IDE, a framework of agents, or a
service other tools call. An AI CLI here means Claude Code, Codex, Copilot's CLI or a similar terminal assistant.

**Document structure.** What a change is written as: which files, which sections, and what happens to them when the
work is finished — kept, archived, or discarded.

**Workflow.** The named steps or commands, and the order they run in. A step is one run of one command.

**AI tool support.** Which AI tools the workflow runs on, and how that support is built: files generated per tool
into the project, or one installation per machine.

**Execution.** Who runs a step. Either a person types the command and follows the run, or the tool runs steps
unattended, with nobody present to answer a question. This criterion also covers what is recorded about a run, such
as its cost.

**Code handling.** How the work reaches the project's default branch: committed and merged by the person, merged by
the tool, or opened as a pull request for review — and whether a test run stands between the work and the merge.
"Not stated" below means the tool's own documentation does not say, not that the tool does nothing.

**Invasiveness.** What the tool leaves behind in the project: files in the working tree, and commits or branches
in the git history. This is what matters when the repository belongs to a customer, or to a team that has not adopted the
tool.

## Summary

| Tool               | Document structure                          | AI tool support                            | Execution              | Code handling                        | Invasiveness                                                               |
|--------------------|---------------------------------------------|--------------------------------------------|------------------------|--------------------------------------|----------------------------------------------------------------------------|
| Aide               | 4 files per spec, then archived             | 4 tools, one install per machine           | By hand, or unattended | Merges, or opens a pull request      | No files required in the repo; branches and merges show in the git history |
| OpenSpec           | Change folder holding a capability delta    | 30+ tools, files in the project            | By hand                | You merge                            | `openspec/` and per-tool commands                                          |
| GitHub Spec Kit    | Spec, plan and tasks under `.specify/`      | 50+ tools, files in the project            | By hand                | You merge                            | `.specify/` and per-tool commands                                          |
| AWS Kiro           | Requirements, design, tasks                 | Its own IDE                                | By hand                | Commits per step; merging not stated | Three documents per feature, plus steering files                           |
| BMAD-METHOD        | Brief, PRD, architecture, user stories      | Any tool with skills; a browser            | By hand                | Not stated                           | Planning documents, plus what each install adds                            |
| GSD                | `.planning/` in the project                 | 12 tools, files in each tool's directories | By hand                | Commits per task; merging not stated | `.planning/`, plus per-tool files                                          |
| Tessl              | Specs in `.tessl/`; published library specs | Any agent that speaks MCP                  | By hand                | Not stated                           | `.tessl/`                                                                  |
| Cursor's Plan Mode | One plan per task, not kept                 | The Cursor editor                          | By hand                | You merge                            | `.cursor/rules/`, if rules are used                                        |
| Augment Code       | None; it supplies context to other tools    | Its own service                            | Not applicable         | Not applicable                       | Nothing                                                                    |

## Aide

**What it is.** A set of skills and scripts installed once per machine, plus a dashboard that can run them. A skill
is a Markdown file holding the instructions for one command, which an AI CLI reads when the command is typed. The
dashboard is a web page served on the machine that runs the work, and it keeps a clone of each project, separate
from any checkout a person uses.

**Document structure.** A spec is a folder of four files: `1-description.md` states the problem as it was reported,
with its acceptance criteria as AC-n SHALL statements, `2-analysis.md` records what the code shows, `3-solution.md`
holds the plan and a given/when/then case for each AC-id, and `4-status.md` records what happened, including the cost of each step. The folder goes in
`specs/` in the project, or in a separate specs repository when `AIDE_SPECS_PATH` in the machine's own
`.aide/config` names one. A finished spec is moved to `archive/`, and the archive step writes what was learned into
the project's own documentation first.

**Workflow.** `/aide-create`, `/aide-analyze`, `/aide-implement`, `/aide-archive`. Beside them: `/aide-explore` for
thinking a problem through, `/aide-manifest` for a project's own settings file, and `/aide-close` and `/aide-reopen`
for specs that stop or come back.

**AI tool support.** Claude Code, Codex, OpenCode and Copilot. The content exists once, in `core/`, and each tool
has a small installer that writes it into the user's home directory: `~/.claude/skills/` for Claude Code,
`~/.agents/skills/` for Codex and Copilot, which also get a generated instructions file, and nothing for OpenCode,
which scans both directories itself. The dashboard's runner, `aide-run-spec`, supports the same four a second way: it
starts each CLI with that CLI's own command line and reads the events it prints while it works. That part is
written and tested per tool, in a set order of priority: Claude Code, then Codex, OpenCode and Copilot.

**Execution.** Both. A person can type a skill in an AI CLI and follow the run. Or a step can be queued on the
dashboard as part of a job — the sequence of steps a spec is to go through — and run unattended: in a git worktree
of its own, under a time limit, on a model chosen for that step. A worktree is a second checkout of the same
repository on a branch of its own, so a run never touches the checkout anyone else is using. The job's row on the
dashboard records the model, the cost, the token count and the reason each step ended. A step running unattended
has nobody to ask, so a step that needs a decision writes the question into the spec's own files and finishes
without the answer. The queue and its limits are in
[Running specs](../dashboard/docs/running-specs.md); what a run does to the repositories is in
[The runner and its checkouts](../dashboard/docs/the-runner.md).

**Code handling.** Aide calls this landing. Each step works on the branch `aide/<spec-folder>`, and when a step
ends the dashboard lands what that step produced. Analyze, close and reopen copy the spec's own folder onto the
default branch and leave the rest of the branch alone. Implement lands nothing: its code stays on the branch
until the archive step, which merges the branch into the default branch and deletes it on origin. Code therefore
reaches the default branch through archive alone. Before a merge is pushed, the project's test suite runs on the
merged result, and a failing run stops the job with nothing merged. With `codeLanding: pr` in the project's
settings, the code branch is left open as a pull request instead, for someone to review and merge. Run by hand,
the skills run the tests themselves, and what to do about a failure — and when to merge — is the person's.
[Branches and landing](../dashboard/docs/landing.md) has the merge, the conflicts and the test gate in full.

**Invasiveness.** In the working tree, two file sets, and both can be kept out. The first is the project's
settings: name, description, test command, worktree links — the gitignored directories a run has to borrow, such
as `node_modules` — and the `codeLanding` choice. The dashboard stores them next to the clones it keeps, and
writes them into the project only where `.aide/project.yaml` is committed there already, a file a team that has
adopted Aide writes itself with the `/aide-manifest` skill or by hand — see
[Projects](../dashboard/docs/projects.md). `.aide/config`, which holds one machine's own settings, is never
committed. The second set is the spec folders, which go in `specs/` unless
`AIDE_SPECS_PATH` points at a specs repository. The workflow itself is never installed into a project, since the
skills live in the user's home directory.

In the git history, a run through the dashboard is visible: it pushes an `aide/<spec-folder>` branch, commits as the
git user of the machine it runs on, and merges into the default branch. Run by hand, the person commits as
themselves and nothing is pushed that they did not push.

## OpenSpec

**What it is.** [OpenSpec](https://github.com/Fission-AI/OpenSpec) is a file-based workflow, run through slash
commands in whichever AI tool the project uses.

**Document structure.** An `openspec/` directory with three parts: `specs/` holds capability documents describing
what the system does today, in Markdown with concrete scenarios; `changes/` holds one folder per change, with its
proposal, spec delta, design and tasks; `archive/` holds the changes that are finished. A change is written as a
delta against the capability documents — ADDED, MODIFIED, REMOVED — and archiving updates those documents, so the
repository always holds a current description of the system.

**Workflow.** `/opsx:explore`, described as "a no-stakes thinking partner that reads your code, weighs options, and
shapes a plan", then `/opsx:propose`, `/opsx:apply` and `/opsx:archive`, with `/opsx:new`, `/opsx:continue`,
`/opsx:verify` and `/opsx:bulk-archive` beside them. A person reviews the proposal before apply runs.

**AI tool support.** "30+ tools and growing", covered by a table with one entry per tool, which writes that tool's own files into the project.
Each tool gets skills at `<tool-config>/skills/openspec-*/SKILL.md`, command files in its own format —
`.claude/commands/opsx/<id>.md`, `.cursor/commands/opsx-<id>.md`, `.amazonq/prompts/opsx-<id>.md` — or skills only,
and the command is written `/opsx:propose`, `/opsx-propose`, `@opsx-propose` or `$openspec-propose` depending on
the tool. `openspec init` writes the files and `openspec update` refreshes them.

**Execution.** By hand. The documentation describes no unattended mode, and nothing is recorded about what a run
cost.

**Code handling.** None of its own. The person commits and merges, as they would without the tool.

**Invasiveness.** The `openspec/` directory and the per-tool command files, both in the project. Nothing is
committed or merged by the tool itself; what reaches the git history is what the person commits.

## GitHub Spec Kit

**What it is.** [Spec Kit](https://github.com/github/spec-kit) is "an open source toolkit that gives AI coding
agents structured processes, reusable templates, and documented outcomes", installed with a Python CLI.

**Document structure.** A constitution file holds the project's principles, written once, and every phase is held
to it. The spec, plan and task files for the work live under `.specify/`, alongside directories for bugs and
assessments.

**Workflow.** `/speckit-constitution` first, then `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`,
`/speckit-implement` and `/speckit-converge`, the last of which checks that the work is complete. Two further sets
of commands cover bug fixing and deciding whether an idea is worth pursuing at all.

**AI tool support.** More than 50 integrations, each with a key of its own. `specify init --integration <key>`
writes the commands into the project in the tool's own format: `.claude/skills`, `.github/skills/`,
`.cursor/skills`, `.gemini/commands`, `.clinerules/workflows` and others, with a `generic` key and `--commands-dir`
for tools that are not in the table.

**Execution.** By hand, in the agent's chat. The documentation describes no unattended mode.

**Code handling.** None of its own; `/speckit-converge` checks that the work is complete, but committing and
merging are the person's.

**Invasiveness.** `.specify/` and the per-tool command files, both in the project. A workflow of six commands used
with three AI tools puts eighteen command files in the repository, saying the same thing in three formats. That is
deliberate — a clone brings the workflow with it — but it is visible to everyone working there.

## AWS Kiro

**What it is.** [Kiro](https://kiro.dev) is an IDE from AWS with agents of its own, able to carry out a task
rather than only suggest code.

**Document structure.** Three documents per feature: `requirements.md` with user stories and acceptance criteria in
EARS notation, a fixed sentence form ("When <trigger>, the system shall …"); `design.md` with the technical
approach; and `tasks.md` with trackable tasks. Kiro's documentation does not state where in the repository they are
stored.

**Workflow.** Requirements, then design, then tasks, with approval gates between the phases. Quick Spec writes all
three documents at once and skips the gates, for a change that is well understood.

**AI tool support.** Its own IDE, which selects between several models itself.

**Execution.** By hand, in the editor. When the tasks run, Kiro works out which of them depend on each other and
runs the independent ones at the same time, in groups it calls "waves". Its task runner takes a step further on its
own: it works in an isolated worktree, on the branch `kirocrew/task/{task_id}`, and carries on through the steps
with checkpoints, retries and a pause.

**Code handling.** The task runner commits as it goes: it runs the step, and "if tests pass, git commits the
change". A separate reviewer then reads "the actual `git diff HEAD~1`", and a failed review means
`git reset --hard HEAD~1`, a retry of the step, and a new commit when it passes. Merging those branches back is
not described. In the editor, Kiro also writes the commit message for what a person has staged.

**Invasiveness.** The three documents per feature, plus the steering files that hold the standing instructions for
the project; their location is not stated. The task runner's branches are named `kirocrew/task/{task_id}`.

## BMAD-METHOD

**What it is.** [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) is a framework of specialized agents,
one per role in the development cycle.

**Document structure.** Planning produces a brief, a product requirements document, architecture documents and then user stories, which the
development cycle works from. How much of this a change gets is meant to match its size: "going directly to
implementation for clear changes", more planning for larger ones.

**Workflow.** The agents — product, architecture, UX, development, testing — hand documents to one another, from
the brief through to the stories and the work on them.

**AI tool support.** Any AI tool that supports skills. It installs as a skills CLI, a Claude Code plugin and a
Codex plugin, and the planning half also runs in a browser as Gemini Gems or a custom GPT.

**Execution.** By hand: a person moves the work from one agent to the next.

**Code handling.** The documentation read for this comparison does not say whether any agent commits, branches or
merges; the testing role reviews the work before it is considered done.

**Invasiveness.** The planning documents in the project, plus whatever each tool's installation puts in it. Where
those documents are written is not stated in the documentation read for this comparison.

## GSD (Get Shit Done)

**What it is.** [GSD](https://github.com/gsd-build/get-shit-done) writes the prompts the agents work from, and is
built around keeping each task in a clean context.

**Document structure.** Everything lives in `.planning/` in the project: `PROJECT.md`, `REQUIREMENTS.md`,
`ROADMAP.md`, `STATE.md`, `config.json`, and directories for `phases/` and `research/`. Each phase directory holds
its own context, research and execution plans. The documentation calls this state "inspectable by both humans and
agents".

**Workflow.** Per phase: discuss, plan, execute, verify. Researchers, planners, executors and verifiers run as
separate agents, with a check between the stages, and each task starts in a fresh context window so that
quality does not fall as the window fills up.

**AI tool support.** Twelve runtimes, among them Claude Code, which it was built for, Codex, OpenCode, Copilot and
Cursor. One installer writes into each tool's own directories.

**Execution.** By hand, but with several agents working in parallel underneath.

**Code handling.** Execution "produces atomic commits per task". Agents working in parallel commit with
`--no-verify`, to avoid fighting over a build lock, and the orchestrator runs the pre-commit hook once after each
wave instead. Merging is not described.

**Invasiveness.** The `.planning/` directory in the project, and the files the installer writes into each AI
tool's own directories.

## Tessl

**What it is.** [Tessl](https://tessl.io/) is a spec platform with two halves: a framework installed in a project,
and a public registry of specs.

**Document structure.** A project's specs live in `.tessl/` and are independent of programming language. The
framework "writes your skills, rules, and config as plain artifacts in your repo", to be "versioned, reviewed, and
rolled out with the same rigor as code dependencies", though the overview does not give their paths. The Spec
Registry holds specs for open-source libraries, so an agent writing code against a library can read the library's
spec instead of relying on what it recalls of the API.

**Workflow.** Its documentation does not describe the steps in detail.

**AI tool support.** Any agent that speaks MCP, the Model Context Protocol.

**Execution.** By hand, through whichever agent is used.

**Code handling.** Its documentation does not state this.

**Invasiveness.** `.tessl/` in the project, together with the skills, rules and config the framework writes
there. The registry specs are published elsewhere and are not part of the project.

## Cursor's Plan Mode

**What it is.** [Cursor](https://cursor.com) is an AI editor; Plan Mode is a mode within it.

**Document structure.** One implementation plan per task, written before any code. It is not kept as a file
afterwards, and there is no archive. The project's rules live in `.cursor/rules/`.

**Workflow.** Clarifying questions first, then the plan, then the code.

**AI tool support.** The Cursor editor, with a choice of models inside it.

**Execution.** By hand, with a person present to answer the clarifying questions.

**Code handling.** The person commits and merges.

**Invasiveness.** `.cursor/rules/`, if the project uses rules. The plan itself leaves nothing behind.

## Augment Code

**What it is.** [Augment Code](https://www.augmentcode.com/) supplies context rather than a workflow. It keeps an
architectural picture of a large codebase, across repositories, for other tools to use.

**Document structure.** None of its own; the spec work happens in whichever tool the team already uses.

**Workflow.** None of its own.

**AI tool support.** Its own service, which other tools query.

**Execution.** Not applicable.

**Code handling.** Not applicable.

**Invasiveness.** Nothing in the repository.

## Aide's design choices

### Steps can run unattended

The dashboard is a single-user tool. It has no sign-in of its own, every job runs on the AI account of the user the
service runs as, and every commit a run makes carries that machine's git user, whoever pressed the button.

- **Advantage:** a step that takes twenty minutes does not occupy a person for twenty minutes, work can be queued
  overnight, and every run leaves a record of what it cost and how it ended.
- **Disadvantage:** it requires a machine that stays on. On macOS the dashboard installs as a launchd service,
  which macOS starts and keeps running; on Linux `dashboard/serve.sh` runs it in a terminal, and nothing restarts
  it after a reboot. A step running unattended cannot ask a question, and a step that goes wrong runs until its
  time limit before anything reports it.

### Landing is part of the workflow, not a step afterwards

- **Advantage:** no step's work has to be merged by hand, the tests cannot be skipped on the way in, and the spec
  and the code move together. A project that reviews every change keeps that review through `codeLanding: pr`.
- **Disadvantage:** the dashboard needs write access to the repositories it merges into. A merge conflict with the
  default branch is resolved by the archive step itself, which means trusting an AI session with the resolution,
  with the test run as the check behind it. Landing belongs to the dashboard, not to the skills: a person running
  the skills by hand merges their own branches.

### One set of skills across four AI tools

- **Advantage:** the workflow does not change when the tool does, and a project is not tied to one vendor's editor.
  A step can run on a cheaper model where that is sufficient.
- **Disadvantage:** four is few beside the thirty to fifty the file-based tools reach, because each of Aide's is
  written and tested by hand rather than generated from a table. The skills also stay within what all four can do,
  so tool-specific features go unused, each tool has its own installer to keep up to date, and support is not
  equal: everything is verified on Claude Code first and on Copilot last.

### Four files per spec, and an archive step that writes back

- **Advantage:** the reasoning outlives the change. A later reader sees the problem as it was reported, what the
  code looked like, what was decided and what it cost, and the project's documentation stays current instead of
  falling behind a growing pile of finished specs.
- **Disadvantage:** four files are more overhead than a single plan file for a small change. And unlike OpenSpec,
  Aide has no capability document describing the system as a whole: the answer to "what does this system do today"
  is in the project's own documentation, and stays correct only for as long as the archive step keeps it there.
