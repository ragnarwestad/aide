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
  - [Correct the spec, not the code](#correct-the-spec-not-the-code)
  - [Keep an archived spec's tests from disappearing unnoticed](#keep-an-archived-specs-tests-from-disappearing-unnoticed)
  - [A review that also holds the code to the repo's own rules](#a-review-that-also-holds-the-code-to-the-repos-own-rules)
- [Parked](#parked)
  - [One project, several code repositories](#one-project-several-code-repositories)
  - [The prompt a run was given, on its job page](#the-prompt-a-run-was-given-on-its-job-page)

---

Ideas we want to weigh for Aide, and where each one stands. What Aide does today is in its own documentation, the
specs and the git history, not here.

## How an idea is kept here

Each idea says where it came from, what it is, and why it might be worth doing. An idea is in one of two places:

- **To consider:** not decided yet.
- **Parked:** worth doing, but waiting for a need or for something else first.

An idea decided against is taken off the page.

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

### Correct the spec, not the code

From Felipe Fontoura's [case study](https://felipefontoura.com/articles/spec-driven-development-case-study/):
"Wrong output means a wrong or incomplete spec. Fix the document, regenerate. Never patch the code and leave the
spec behind." Aide can already do it: change an acceptance criterion and run Analyze again, or reopen a spec. But it
is written down nowhere as the way to fix a wrong result, and nothing stops the code being patched by hand while the
spec still says something else. It could be a rule in the workflow, or a check that a change on a spec's branch made
by hand is reflected in its description.

### Keep an archived spec's tests from disappearing unnoticed

From weighing how OpenSpec keeps its specs true. A test is tied to an acceptance criterion only by its name carrying
"(AC-3)", and the same id is in many specs, so nothing knows which spec a test proves. The record of a spec's tests
is made once, after its implement, and only from the tests its branch added. A later change, in another spec or by
hand, can remove a test or change what it checks, and as long as the suite stays green it lands, with nobody told that
an archived spec's criterion has lost its proof.

- **A test names its spec**, such as "(597/AC-3)" rather than "(AC-3)", so a test can be traced to the spec it
  proves.
- **A removed or renamed test is caught by the landing.** The diff between the default branch and what is about to
  be merged shows a line with such a name leaving a test file; when the name is found nowhere afterwards, the landing
  says which archived spec's criterion lost its test, as a warning or a stop.
- **A changed test is pointed out, and judged by the review.** Whether a test whose body changed still checks what
  its criterion says cannot be told from git: it may only have been tidied. The landing says that the test changed,
  and the review after implement, which already reads the diff, checks that it still proves the archived criterion.

### A review that also holds the code to the repo's own rules

From Matt Pocock's [`code-review`](https://github.com/mattpocock/skills/tree/main/skills/engineering/code-review)
skill, listed on [skills.sh](https://www.skills.sh/). It reviews a diff on two axes, each in a sub-agent of its own,
and reports them side by side without merging them: Spec (does the code do what the spec asked?) and Standards (does
it follow the repo's own documented rules?). The review after an implement in Aide has the Spec axis alone: defects
against the description, and changes that fall under "Out of scope".

- **An axis for the repo's own rules.** Not style, but the rules written down: the testing rules (no wording pins, no
  layout tests, one test per rule) and the code-health limits. On spec 581 the tests pinned wording, and the review
  found nothing, since it read the description alone.
- **The three Spec questions asked outright:** what the spec asked for that is missing or partial, what the diff
  does that nobody asked for, and what looks implemented but is wrong. "Out of scope" covers the second only when a
  description has the section.
- **Every finding cites its source**, the criterion's line or the rule and its file, so the implement turn that fixes
  it, and the person, can check it.

Its baseline of code smells is left out: they are judgement calls, and noise for a review whose findings go back to
be fixed.

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
