# Roadmap

## Table of contents

- [How an idea is kept here](#how-an-idea-is-kept-here)
- [To consider](#to-consider)
  - [1. A commit body that says what was wrong and what stays unchanged](#1-a-commit-body-that-says-what-was-wrong-and-what-stays-unchanged)
  - [2. One map of the system, updated in the same change](#2-one-map-of-the-system-updated-in-the-same-change)
  - [3. A run that can ask a question and wait for the answer](#3-a-run-that-can-ask-a-question-and-wait-for-the-answer)
  - [4. An append-only event log for runs](#4-an-append-only-event-log-for-runs)
  - [5. The spec-structure rule describes how specs are written now](#5-the-spec-structure-rule-describes-how-specs-are-written-now)
  - [6. The plan review checks the scenarios and the test list](#6-the-plan-review-checks-the-scenarios-and-the-test-list)
  - [7. A Claude Code mod that shows the board in a session](#7-a-claude-code-mod-that-shows-the-board-in-a-session)
  - [8. Aide's skills as a Claude plugin](#8-aides-skills-as-a-claude-plugin)
  - [9. Correct the spec, not the code](#9-correct-the-spec-not-the-code)
  - [10. Keep an archived spec's tests from disappearing unnoticed](#10-keep-an-archived-specs-tests-from-disappearing-unnoticed)
  - [11. A review that also holds the code to the repo's own rules](#11-a-review-that-also-holds-the-code-to-the-repos-own-rules)
  - [12. One project, several code repositories](#12-one-project-several-code-repositories)
  - [13. A flow suited to the kind of task](#13-a-flow-suited-to-the-kind-of-task)
  - [14. More than one way to run a step](#14-more-than-one-way-to-run-a-step)
  - [15. A spec's complexity chooses the AI](#15-a-specs-complexity-chooses-the-ai)
  - [16. Create and archive with as little AI as possible](#16-create-and-archive-with-as-little-ai-as-possible)
  - [17. Aide as a Mac app](#17-aide-as-a-mac-app)
  - [18. A run that reaches only its own repository](#18-a-run-that-reaches-only-its-own-repository)
  - [19. Shorter command output for a run](#19-shorter-command-output-for-a-run)
  - [20. A spec's states, separate from its run's](#20-a-specs-states-separate-from-its-runs)
  - [21. Named profiles for the AI and the step settings](#21-named-profiles-for-the-ai-and-the-step-settings)
  - [22. An analysis and a plan that are easier to read](#22-an-analysis-and-a-plan-that-are-easier-to-read)
  - [23. An agent that tries the criteria in a browser before a person ticks them](#23-an-agent-that-tries-the-criteria-in-a-browser-before-a-person-ticks-them)

---

Ideas we want to weigh for Aide, and where each one stands. What Aide does today is in its own documentation, the
specs and the git history, not here.

## How an idea is kept here

Each idea says where it came from, what it is, and why it might be worth doing, at the level of a goal rather than
a design. An idea decided against is taken off the page.

An idea that becomes a spec names it, and leaves this page once the spec is archived.

Each idea has a number that stays with it. A new idea gets the next number after the highest one ever given, and
the number of an idea taken off the page is never used again, so a number can be referred to and still mean the
same idea later. The next number is 24.

## To consider

### 1. A commit body that says what was wrong and what stays unchanged

From [OpenGeni](https://github.com/Cloudgeni-ai/opengeni): a fix's commit says what was wrong, why, what it meant for
a user, and what deliberately does not change, so the next reader does not undo something that was intended.

### 2. One map of the system, updated in the same change

From OpenGeni: one map of how the system is built, kept current by the same change that alters it, since "a stale map
is a bug". Aide has most of the map in its documentation table; the rule that keeps it current is
missing.

### 3. A run that can ask a question and wait for the answer

From OpenGeni: a run that meets something unclear asks, and carries on once it has the answer, instead of guessing or
stopping. Aide has this for two fixed questions; the goal is a run that can ask anything.

### 4. An append-only event log for runs

From OpenGeni: every event of a run is kept in order, so any view, a reload or an audit can replay what happened.
Aide keeps each job's latest state, so a run's history cannot be replayed. [T3 Code](https://t3.codes/) works this
way: every thread is kept as its events, with a checkpoint after each turn that can restore the files and the
conversation ([architecture notes](https://github.com/pingdotgg/t3code/blob/main/AGENTS.md)).

### 5. The spec-structure rule describes how specs are written now

From comparing Aide's specs with the sources in `docs/SPEC_WRITING_SOURCES.md`: the rule for the spec files should
describe a spec as it is written today, throughout.

### 6. The plan review checks the scenarios and the test list

From the same comparison: the plan review holds a plan's scenarios to the criteria they come from, and its tests to
the testing rules.

### 7. A Claude Code mod that shows the board in a session

From Claude Code's mods: the board's work shown inside the session working on Aide.

### 8. Aide's skills as a Claude plugin

From "Build plugins for Claude" and the Claude Marketplace: a second way to deliver Aide's skills to Claude users,
beside the installer that also serves Codex, OpenCode and Copilot.

### 9. Correct the spec, not the code

From Felipe Fontoura's [case study](https://felipefontoura.com/articles/spec-driven-development-case-study/): a wrong
result is fixed in the spec and run again, never patched in the code while the spec says something else.

### 10. Keep an archived spec's tests from disappearing unnoticed

From weighing how OpenSpec keeps its specs true: an archived spec's criteria stay proven over time, so a later change
cannot remove or weaken the test behind one without anyone being told.

### 11. A review that also holds the code to the repo's own rules

From Matt Pocock's [`code-review`](https://github.com/mattpocock/skills/tree/main/skills/engineering/code-review)
skill: the review after an implement checks the code against the repo's own written rules as well as against the
spec, and says what is missing, what nobody asked for, and where each finding comes from.

### 12. One project, several code repositories

A system is often a frontend and one or more backends: one spec that changes all of a project's code repositories
in the same run, each landing through its own pull request. Worth doing once there is a real system with several
repositories to try it on.

### 13. A flow suited to the kind of task

From comparing Aide with agents started by hand from the command line, where each run can be shaped to its task: a
spec says what kind of task it is, and analyze and implement follow a flow suited to it. Much of this can be said in
the spec itself; the goal is that the runner also checks the flow's own rules where it can, without trusting the
agent. Birgitta Böckeler's [look at Kiro, spec-kit and Tessl](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
found one fixed flow far too heavy for a small bug fix. Kinds of task:

- **A bug fix:** a test that reproduces the bug is red before the change and green after it.
- **A refactor:** the behaviour does not change, so the existing tests stay as they are and green throughout.
- **A quick fix:** built — a small spec gets a short analysis within limits the runner checks, and implement
  can send it back to a full one once (`dashboard/docs/spec-lifecycle.md`).
- **Explore first:** the analysis builds a throwaway prototype to learn from before it writes the plan.

What the measurement behind the quick fix found is in `docs/REPLAY.md`, "What the rounds found".

### 14. More than one way to run a step

From the same comparison, and the talk of running many agents at once: how a step is run, whatever the task, can
vary in how many agents work on it, how long they keep going, and who checks the result. What works, by
Cognition's [follow-up](https://cognition.com/blog/multi-agents-working) to its
[earlier warning](https://cognition.com/blog/dont-build-multi-agents): the extra agents give judgment while one
agent writes the code, such as a review in a fresh session, or a model asking a stronger one, often from another
provider. Agents writing at the same time still do not work, and Anthropic's
[research system](https://www.anthropic.com/engineering/multi-agent-research-system) found coding a poor fit for
splitting between agents. Possible ways:

- **A second opinion:** two models each analyse the spec, and their plans are compared or merged.
- **Competing implementations:** two models each implement the spec, and the one that does best on the tests and
  the review is kept.
- **Split the spec:** one agent divides the work, by criterion or by part of the code, and several agents take a
  part each at the same time. The riskiest of these: agents working at once each make decisions the others do not
  see, and the parts may not fit together.
- **Planner and doer:** a strong model writes the plan, a cheaper one makes the changes and asks the planner when
  stuck.
- **Keep going until done:** the turn goes on until the tests are green and every criterion has a test, within a
  limit on time or cost, rather than for a fixed number of rounds.
- **One criterion at a time:** each criterion is made green and committed before the next.
- **A review by another model,** or several reviews with a focus each: the spec, the repo's own rules, security.
- **The agent checks in a browser:** a change to a page is tried in a real browser before the step ends.

### 15. A spec's complexity chooses the AI

From weighing how the AI and model for each step are chosen today: by habit, or to try a model out, rarely from how
hard the spec is, since a person grades a spec no better than the analysis does. Once a spec's complexity can be judged
well, it could choose the AI, model and effort for the steps after the analysis, with a person's own choice still
winning. One way that keeps the risk low: the grade only raises the choice, so a stronger model takes the hard specs
and a wrong grade never gives a weaker one than today.

What the research found, and what it means for the order of the work:

- **The shape of the change predicts difficulty, the description hardly does.** Lines deleted, how many separate places
  the change touches and how far apart, and the size of the repository predicted whether an agent succeeds
  ([What makes issue resolution tasks difficult](https://arxiv.org/html/2608.18280)); the wording of the task added
  almost nothing, and predicting from the text alone transfers poorly
  ([Predicting task difficulty without rollouts](https://arxiv.org/html/2608.05797)). A grade set once the code is
  read, or read off the plan, is the useful one.
- **What works learns from its own history.** [Agent-as-a-Router](https://www.alphaxiv.org/abs/2606.22902) chooses
  from how the most similar earlier tasks went, and [Cursor Router](https://cursor.com/docs/cursor-router) is trained
  on real requests; no single model was best at every kind of coding task.
- **The products route mostly to save money.** [RouteLLM](https://www.lmsys.org/blog/2024-07-01-routellm/) kept 95 %
  of the strong model's quality with a quarter of the calls; Claude Code's `opusplan` plans with Opus and carries out
  with Sonnet, as Aide's own defaults do. For Aide the value is the other way round: a hard spec not implemented by too
  weak a model.

So the first step is to measure, not to route: keep, for each spec, the shape of its change (files, separate places
changed, lines), the model each step ran with, and how it went (green at the first try, rounds of red tests, defects
the review found, a step run again). Only once that shows what predicts trouble should anything choose the model.

What a first measurement found (2026-10-22), from how full the context window got in each of 342 implement sessions
on Claude: the highest sum of a turn's input and cache tokens in the main session, read from the step's stream. No
session was compacted; the fullest reached about 626,000 tokens, 63 % of the 1,000,000-token window Claude reports.

| Context at its fullest | Sessions | Ended badly | Red tests at least once | Review found defects |
| ---------------------- | -------- | ----------- | ----------------------- | -------------------- |
| Under 100,000          | 60       | 15 %        | 16 %                    | 18 %                 |
| 100,000–200,000        | 171      | 4 %         | 8 %                     | 10 %                 |
| 200,000–300,000        | 67       | 0 %         | 13 %                    | 20 %                 |
| Over 300,000           | 44       | 14 %        | 19 %                    | 23 %                 |

"Ended badly" is a step that stopped on red tests, no progress, its time limit, its budget or a refusal; the last two
columns cover the 174 sessions that kept a run log. Over 300,000 tokens a session ended badly about four times as
often as between 100,000 and 300,000, but the numbers are small, and the cause may run the other way: every round of
red tests fills the window, so a session that struggles grows full. Under 100,000 the failures are mostly sessions
that stopped early. Telling cause from effect needs the context measured before the first test round, kept with
each step's result, before any limit is set on it.

What a limit could then do: the runner reads the stream as it arrives, so it can follow how full the window is after
every call to the model. At a limit it could end the session and start a new one that picks up from the plan, the work
committed so far and the test results, instead of letting the session grow or compact.

A limit is a share of the window, not a number of tokens, since the windows differ by model:

| AI     | Model                                      | Context window | Where the tool says it                                                 |
|--------|--------------------------------------------|----------------|------------------------------------------------------------------------|
| Claude | Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1 | 1,000,000      | `contextWindow` under `modelUsage` in the result that ends the session |
| Codex  | gpt-6.1-sol                                | 475,000        | `model_context_window` on every `token_count` in Codex's session file  |
| Codex  | gpt-6-astra                                | 258,400        | the same                                                               |

The same 300,000 tokens is 30 % of Claude's window and 116 % of gpt-6-astra's, where the session would already have
been compacted. Codex states the window with every count; Claude only in its closing result, so the runner would take
it from the model's previous run. OpenCode relays its provider's model, and the board has no OpenCode run to read
it from yet.

Every source the research read:

- Task difficulty:
  - [What Makes Software Issue Resolution Tasks Difficult for Agents?](https://arxiv.org/html/2608.18280)
  - [Predicting Task Difficulty Without Rollouts](https://arxiv.org/html/2608.05797)
  - [Agent Psychometrics: Task-Level Performance Prediction in Agentic Coding Benchmarks](https://arxiv.org/html/2604.00594v2)
- Routing between models:
  - [Agent-as-a-Router: Agentic Model Routing for Coding Tasks](https://www.alphaxiv.org/abs/2606.22902)
  - [Triage: Routing Software Engineering Tasks to Cost-Effective LLM Tiers via Code Quality Signals](https://arxiv.org/pdf/2604.07494)
  - [Dynamic Model Routing and Cascading for Efficient LLM Inference: A Survey](https://arxiv.org/pdf/2603.04445)
  - [RouteLLM: An Open-Source Framework for Cost-Effective LLM Routing](https://www.lmsys.org/blog/2024-07-01-routellm/)
  - [Best AI Model for Coding Agents in 2026: A Routing Guide](https://www.augmentcode.com/guides/ai-model-routing-guide)
- The products:
  - [Cursor Router](https://cursor.com/docs/cursor-router)
  - [I Tested Whether Cursor's Auto Mode Actually Picks the Right Model](https://dev.to/nedcodes/i-tested-whether-cursors-auto-mode-actually-picks-the-right-model-20ml)
  - [About Copilot auto model selection](https://docs.github.com/en/copilot/concepts/models/auto-model-selection)
  - [Why Copilot's Auto Mode for AI Models Ignores Your Actual Task](https://visualstudiomagazine.com/articles/2026/02/06/why-copilots-auto-mode-for-ai-models-ignores-your-actual-task.aspx)
  - [Claude Code model configuration, with `opusplan`](https://code.claude.com/docs/en/model-config)

### 16. Create and archive with as little AI as possible

From the same weighing: create and archive are the least complex steps, and much of them is mechanical. Create already
runs without AI when the acceptance criteria are not to be formulated, and archive when the spec cannot be archived
yet. The goal is that AI is used only for what needs judgment: formulating criteria, resolving a merge conflict,
and that everything else is done by scripts.

### 17. Aide as a Mac app

From looking at how [T3 Code](https://t3.codes/) is installed: on a Mac, Aide is installed like any other app, with
`brew install --cask aide` or a `.dmg` from GitHub Releases. Today it takes a git clone, `install-all.sh` and
`dashboard/install.sh`. On its first start the app does what those scripts do. It installs the scripts, the skills
and the rules, shows which AI tools are installed and logged in, and adds the first project. Then it updates itself.

How T3 Code does it ([source](https://github.com/pingdotgg/t3code)):

- **The app:** Electron, built with `electron-builder` into a `.dmg` and a `.zip`. The server is inside the app and
  runs on Electron's own Node, so the user needs no Node installed.
- **Signing:** GitHub Actions signs with a Developer ID certificate and notarises with an Apple API key. Without
  those secrets the app is built unsigned.
- **Updates:** `electron-updater`, from GitHub Releases, checked at start and on a timer.
- **Homebrew:** the cask is in Homebrew's own collection (`Homebrew/homebrew-cask`), marked `auto_updates`. T3 Code
  itself only publishes the releases.
- **A service at login:** not the app's job. Its command line installs it (`t3 service install`), as launchd on a
  Mac and systemd on Linux. The app runs the server only while it is open.

What it would mean for Aide:

- **Electron, with Bun inside the app.** Electron because Aide also runs on Linux. The dashboard cannot run on Node
  as it is: `Bun.serve`, `Bun.spawn` and `Bun.build` are used in the server, the runs and the landing. The app
  therefore carries the `bun` program, about 60 MB, and starts the dashboard with it, as `dashboard/serve.sh` does.
- **Releases with a version.** Today the board installs from main with Deploy. A Mac app is updated by releases
  instead. The two can live side by side: a machine Aide is developed on deploys from main, and other machines use
  the app.
- **An Apple Developer account**, at 99 dollars a year, for macOS to open the app without a warning. Without it, the
  app can be opened only with right-click and Open, which is enough for one's own machines.
- **The board's host keeps its service.** A machine that runs the queue around the clock keeps the launchd service;
  the app is for the person at the machine.

It is too large for one spec. A split:

1. The app, with Bun inside it, which starts the dashboard and opens it in a window.
2. The first start: install the scripts, skills and rules, find the AI tools, add a project.
3. Releases: a version number, a signed and notarised build on GitHub Releases, updates, and a Homebrew cask.

### 18. A run that reaches only its own repository

From [sandcastle](https://github.com/mattpocock/sandcastle), which runs each coding agent in a container on a branch
of its own and merges its commits back. A step on the board runs the AI tool as the user, with `bypassPermissions`:
every command it runs can read and write the whole home directory (SSH keys, the GitHub login, other projects'
`.env` files, the specs repository, the dashboard's own files) and reach the whole network. A command that goes
wrong, or that text in a README or an issue talks a run into, can do anything the user can. The risk is the
machine's, whoever owns the repository.

Two ways to narrow it:

- **a. The AI tool's own sandbox.** Claude Code can confine the commands it runs with macOS's own sandbox: writes only
  inside the working directory, network only to allowed domains. Codex has `workspace-write`. A setting per run in
  place of `bypassPermissions`, with no Docker; what has to be tried out is every place a project's tests write or
  fetch from, each of which must be allowed. It could be turned on per project, leaving Aide out until its own suite
  is known to pass inside it.
- **b. A container per run, as sandcastle does.** Only the worktree is mounted; the AI tool gets its own token
  (`claude setup-token`) and no SSH keys or GitHub login, and the runner outside commits, pushes and lands as today.
  The strongest boundary, at the cost of Docker or Podman on the serving host, an image per project, dependencies
  built inside the container rather than linked in, and Aide's own suite, which assumes macOS, behaving differently
  on Linux. [container-use](https://github.com/dagger/container-use) does the same through an MCP server, built on
  Dagger: each agent gets a container on a branch of its own, and its commands and logs can be read afterwards.

Neither keeps a run from damaging or reading its own repository, or from sending what it reads out, unless the
network is narrowed too. Option a is where to start.

### 19. Shorter command output for a run

From [rtk](https://github.com/rtk-ai/rtk), which sits between the AI tool and the shell and shortens what common
commands print before the agent reads it: a test run reduced to its failures, `git log` to one line per commit,
`git diff` without its context lines. Its authors measure 60-90% less command output; they point out that this is
a share of the output alone, not of the cost, which also counts the prompt, the conversation and the answer.

A step on the board reads a great deal of command output: the tests it runs while it works, the diffs a review
reads, the logs of a failing run. Less of it means more of the step's context left for the work, and less to pay
for on a long implement.

Two ways to get it:

- **a. rtk itself**, installed on the serving host and turned on for the runs. It hooks into Claude Code's Bash tool
  only; Read and Grep pass it by.
- **b. The runner shortening more of what it hands a session.** After a red test run it already hands back the
  failing lines alone; the commands a session runs itself are not shortened.

Measured on the board's last 60 analyze and implement steps (October 2026), neither is worth doing now. Of what
the tools handed the sessions, reading files was 66% (`cat`, `sed` and `head` 41%, the Read tool 25%), searching
and listing 24% (`grep`, `rg`, `find`, `ls`), git 6%, and test runs and checks 2%. What rtk shortens best, test
runs and git logs, is about 6% of it; the files a session reads are what it needs to change the code, and cannot
be shortened without losing that. The large share is finding and reading code.

### 20. A spec's states, separate from its run's

A tidy-up rather than a feature. The states a row shows have grown one at a time and overlap: Ready and Idle mean
the same thing, "Stopped" names both a job the user stopped and a step that ended without finishing, and a
cancelled step wears Stopped's amber badge while the state filter counts it as Failed. Now that how a run is going
is shown mainly on the Running page, the Specs page needs only the spec's own state.

The proposed model:

- **Open**, the spec is being worked on, and is either:
  - **Idle:** nothing runs, and the next phase waits for the user to press it (today's Ready).
  - **Active:** something is happening to it, and it is Waiting (queued, or waiting on a spec it depends on),
    Running, Stopped (the board stopped it on purpose and says what must be settled: red tests, another spec
    changing the same files, unticked acceptance criteria) or Failed (something went wrong).
- **Archived**
- **Closed**

The Specs page shows the top level alone: Open (Idle or Active), Archived and Closed. Waiting, Running, Stopped and
Failed are shown on the Running page.

Open question: where a step the user cancelled belongs.

- **a. Stopped.** It shows that someone stopped it on purpose, at the cost of Stopped no longer meaning only that
  the board stopped it.
- **b. Idle.** Nothing needs fixing and the spec stands where it stood before the step, at the cost of a cancelled
  spec looking the same as one never started.

### 21. Named profiles for the AI and the step settings

From the user's wish to save choices once instead of setting them phase by phase. Today there is one table of
models per step, under Settings → AI, and a spec can change the model of any of its phases. A profile is a named
set of those choices, such as "Standard", "Cheap" or "Thorough", saved once and chosen for a project or a single
spec.

What a profile could hold:

- **The AI and model for each step:** the table Settings → AI has today, which becomes the profile "Standard".
- **The step settings:** acceptance ticking, AI formulation, criteria checks and choosing an approach, and the ones
  fixed in code today: whether the review runs, how many rounds red tests get, and the time limit. A "Quick"
  profile could then run Sonnet without plan review or code review, and a "Thorough" one Opus with every check on.

Open questions:

- Whether a profile is chosen per project, per spec, or both, with the spec's own choice winning.
- Whether profiles by field (frontend, backend, cloud, AI, embedded) are worth having. As instructions they add
  little to what a project's own CLAUDE.md, AGENTS.md and rules already say. As checks that run, such as a browser
  check for a frontend change, they could catch defects; that is the part to start from, and only once a project
  shows the need.

Ideas 13, 14 and 15 are what a profile could later carry: a flow for the kind of task, a way to run a step, and an
AI chosen from the spec's complexity.

### 22. An analysis and a plan that are easier to read

From Andrej Karpathy's [post](https://x.com/karpathy/status/2105819303471976479) on making what an AI writes easier
to understand, and a colleague's plans written with as many diagrams as possible. `2-analysis.md` and
`3-solution.md` are where the AI writes the long passages a person has to read and understand, so that is where it
would help most. Two ways, which can be taken together:

- **Simplified technical English:** ASD-STE100, the controlled English of aerospace maintenance manuals, about 80%
  of the way to the full standard.
- **Diagrams:** a small Mermaid diagram in the analysis and the plan, such as the files a change touches or a flow
  before and after. Mermaid is plain text in the Markdown, so the files read as well for an AI as they do today.

What it could take:

- **The writing rules, not the dictionary:** short sentences (at most 20 words in an instruction, 25 in a
  description), the active voice, one word for one thing, and one topic in each sentence. The approved dictionary of
  about 900 words is left out, since words like branch, worktree and landing would have to be declared as technical
  names one by one.
- **The analyze skill first:** the rules added to what `/aide-analyze` writes, and a few specs compared before and
  after, before they are used anywhere else.
- **Diagrams drawn on the spec page:** the analyze skill asks for one where a picture says more than the text, and
  the spec page draws Mermaid, which it shows as a code block today.

Open questions:

- Whether the board's error sentences (`dashboard/docs/error-sentences.md`) and the documentation take the same
  rules afterwards; both already follow some of them.

### 23. An agent that tries the criteria in a browser before a person ticks them

From GitHub Next and Microsoft Research's [PDD Kit](https://x.com/GitHubNext/status/2112936525457740139), compared
in `docs/COMPARISON.md`: what a proof cannot cover, it checks with tests and with agents that use a browser or the
screen. Aide checks an implementation with the tests implement writes, the review after it, and last a person
ticking each acceptance criterion. Criteria about what a page shows or does are often the ones a person has to try
by hand, or mark Not yet.

An agent between the tests and the person could open the test server a held-back spec offers, try each criterion
in a browser, and note on its row what it saw, so the person starts from that rather than from nothing. The
person still ticks: the agent's note is evidence, not a tick.

Open questions:

- How PDD Kit's own browser agents work, which its demo at GitHub Universe (28–29 October 2026) should show.
- Which criteria the agent may try, since a criterion about an email, a deploy or another machine cannot be tried
  in a browser on the test server.
- What it costs per spec, and whether it runs for every held-back spec or only on request.
