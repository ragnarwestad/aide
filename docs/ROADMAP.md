# Roadmap

## Table of contents

- [How an idea is kept here](#how-an-idea-is-kept-here)
- [To consider](#to-consider)
  - [A commit body that says what was wrong and what stays unchanged](#a-commit-body-that-says-what-was-wrong-and-what-stays-unchanged)
  - [One map of the system, updated in the same change](#one-map-of-the-system-updated-in-the-same-change)
  - [A run that can ask a question and wait for the answer](#a-run-that-can-ask-a-question-and-wait-for-the-answer)
  - [An append-only event log for runs](#an-append-only-event-log-for-runs)
  - [The spec-structure rule describes how specs are written now](#the-spec-structure-rule-describes-how-specs-are-written-now)
  - [The plan review checks the scenarios and the test list](#the-plan-review-checks-the-scenarios-and-the-test-list)
  - [A Claude Code mod that shows the board in a session](#a-claude-code-mod-that-shows-the-board-in-a-session)
  - [Aide's skills as a Claude plugin](#aides-skills-as-a-claude-plugin)
- [Parked](#parked)
  - [One project, several code repositories](#one-project-several-code-repositories)
  - [The prompt a run was given, on its job page](#the-prompt-a-run-was-given-on-its-job-page)
- [Not pursued](#not-pursued)

---

Ideas we want to weigh for Aide, and where each one stands. What Aide does today is in its own documentation, the
specs and the git history, not here.

## How an idea is kept here

Each idea says where it came from, what it is, and why it might be worth doing. An idea is in one of three places:

- **To consider:** not decided yet.
- **Parked:** worth doing, but waiting for a need or for something else first.
- **Not pursued:** decided against, with the reason, so the question is not opened again by accident.

An idea that becomes a spec names it, and leaves this page once the spec is archived.

## To consider

### A commit body that says what was wrong and what stays unchanged

From [OpenGeni](https://github.com/Cloudgeni-ai/opengeni). Its bug-fix commits have a fixed body: what the wrong
behaviour was, the mechanism behind it, what it meant for a user, and what deliberately does not change. The git rule
asks only for an optional "why". The last part is what stops the next reader from undoing something that was
intended.

### One map of the system, updated in the same change

From OpenGeni, whose `CLAUDE.md` points at one architecture page and says a change that alters the shape of the
system updates that page in the same change: "a stale map is a bug". `.claude/CLAUDE.md`'s "Reading the
documentation" table and the wiki give Aide most of the map already; the rule that the same change keeps it current
is what is missing.

### A run that can ask a question and wait for the answer

From OpenGeni, where a running agent can ask for an answer and carry on from the same point once it has one. A run
in Aide can only guess or stop when something is unclear. Two fixed questions exist: an Implement held back while the
user picks an approach, and an Analyze that stops on its acceptance-criteria checks. A free question from any run,
answered on its row, would be the general form.

### An append-only event log for runs

From OpenGeni, which writes every event to a log first and builds every view from it, so a reload, a second client
and an audit all see the same history. The queue keeps each job's current state, and `aide-emit-run` posts phase
boundaries with no guarantee they arrive, so nothing can be replayed. A `runs/<id>.jsonl` appended to would be
enough; no database is needed.

### The spec-structure rule describes how specs are written now

From comparing Aide's specs with the sources in `docs/SPEC_WRITING_SOURCES.md`. Specs are written as Problem,
Solution and acceptance criteria in EARS, with an optional "Out of scope", but `core/rules/spec-structure.md` still
describes parts of an older form. The rule should say how a spec is written today, throughout.

### The plan review checks the scenarios and the test list

From the same comparison. Every plan rewrites the acceptance criteria as Given/When/Then that nobody approves, and
some plans list tests the testing rules do not allow: markup checks, or one rule tested on several layers. The plan
review could check that each scenario says what its criterion says, raise its own readings as open questions, and
check the test list against the testing rules.

### A Claude Code mod that shows the board in a session

From Claude Code's mods (v2.1.287): plugins that add a pane, a status line or a hook inside a session, reloaded
while it runs. Aide's hooks are shell commands. A mod could show the board's running specs and their state in the
session that is working on Aide.

### Aide's skills as a Claude plugin

From "Build plugins for Claude" and the Claude Marketplace. Aide installs its skills with its own scripts. A plugin
could be another way to deliver them to Claude users, but Aide also serves Codex, OpenCode and Copilot, so it would be
a second channel, not a replacement.

## Parked

### One project, several code repositories

A system is often a frontend and one or more backends, but a project has one code repository and its specs
repository, so a change across the API and the frontend cannot be one spec. Parked until there is a need and a real
system with several repositories to test on. The agreed shape:

- The Projects page lists several code repositories for one project, each with its own test command and worktree
  links.
- One spec branches every repository, so analyze and implement see and change all of them in the same run. The
  runner already branches, commits and pushes more than one repository per run.
- Pull-request mode only, since this is a team setting with its own review: archive opens one pull request per code
  repository whose branch has changes, each linking the others and the spec. The specs repository still merges on its
  own, and the runner's tests run in every repository before any pull request is opened.
- The row says it is waiting on pull requests until every branch is merged on origin, and names the repositories
  still waiting. The order of the merges and the review are the team's.

### The prompt a run was given, on its job page

From finding out why GPT-6.1 Sol stopped on archive: the runner's prompt and the archive skill said different
things, and the prompt had to be rebuilt from the runner's code to see it. Storing each run's prompt with its log,
and showing it on the job page, would let the user and a session read what the run was told. Parked until it is
needed again.

## Not pursued

- **Adopting whippletree.** It compiles one hook contract onto several tools and ships a compiled dispatcher per
  bundle. Aide distributes prompts and short shell scripts, so a compiled layer costs more than it gives.
- **Running OpenGeni.** It is a whole product: Postgres, Temporal, NATS and S3 storage. Its ideas are above; the
  product itself is not something to run beside Aide.
- **An `aide` command that forwards to the `aide-*` scripts.** It would only change how the commands are written;
  nothing is missing with the scripts as they are.
- **Decision pages in the wiki.** They recorded what one spec chose, went out of date without a word, and duplicated
  the ordinary pages. The reasons for a rule now live as one line on the page that covers the code.
