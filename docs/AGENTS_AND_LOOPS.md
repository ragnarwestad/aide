# Agents and loops

## Table of contents

- [The strategy](#the-strategy)
- [Two kinds of agent](#two-kinds-of-agent)
- [Step by step](#step-by-step)
  - [Create](#create)
  - [Analyze](#analyze)
    - [The complexity grade](#the-complexity-grade)
  - [Implement](#implement)
  - [Held back](#held-back)
  - [Archive](#archive)
  - [Close and Reopen](#close-and-reopen)
  - [Merge](#merge)
- [The loops](#the-loops)
- [Settings](#settings)
- [What Aide does not do](#what-aide-does-not-do)

---

How Aide uses AI agents when the board runs a spec: which sessions run in each step, which agents start others, the
loops that send work back, and who decides that a step is done. The details of each part are in
[the runner's page](../dashboard/docs/the-runner.md) and in the skills under `core/skills/`.

## The strategy

- **Fixed steps.** A spec goes through the same steps every time: create, analyze, implement, archive. An agent
  works freely inside a step; the order of the steps, and what moves a spec from one to the next, is not the agent's
  to decide.
- **One agent writes.** Inside a step, one session changes the files. No two agents write to the same spec at once.
- **Extra agents only judge.** A second agent reads and reports, and never changes anything itself. What it finds goes
  back to the agent that wrote the work. A landing's repair session is the one exception: once the step is done, it
  fixes tests the merge broke, or a conflict in Merge, and the landing tests the result again.
- **The spec is the memory.** Each step starts a new session. What one step leaves for the next is in the spec's four
  files, not in a conversation, so every session starts with a clean context.
- **The runner checks, not the agent.** What an agent says about its own work decides nothing. The runner runs the
  tests itself, refuses changes outside the spec's own folder, and the landing runs the whole suite on exactly what
  main is about to become.
- **A person at both ends.** A person writes what is to be done, and decides whether the result is good enough.
  Between those two points the agents run unattended, with every permission granted in advance.
- **Many specs at once, not many agents per spec.** Several specs run at the same time, each in its own worktree.

## Two kinds of agent

- **A session the runner starts.** `aide-run-spec` calls `claude`, `codex` or `opencode`: either a new session, or one
  that already exists, continued.
- **A subagent a session starts.** The skill tells the session to start one, through the tool's own way of doing so.
  The runner does not see it; it sees only what the session wrote.

## Step by step

### Create

1. When the New spec form asks the AI to formulate the acceptance criteria, the runner starts one new session with
   `aide-create`. It writes the spec's files and fills in the criteria that are missing.
2. When it does not, no AI runs: a script writes the files from what the form sent.

No subagents and no review.

### Analyze

1. The runner starts one new session with `aide-analyze`.
2. The session reads the description and the code, and writes `2-analysis.md`, with a list of the files the change
   will touch under `### Files to change`.
3. **The comparison.** The session runs `aide-spec-overlap`, which compares that list with the lists of the other
   open, analyzed specs in the project. When one shares a file, the analysis ends there, stopped: no plan, no review.
   After the turn the runner runs the same command and ends the step `shared-files` if the session did not
   ([The runner](../dashboard/docs/the-runner.md)).
4. The session writes the plan in `3-solution.md`, with more than one approach when the spec asks for a choice and the
   approaches really differ.
5. **The plan review.** The session starts subagents that read only the spec's four files, never the reasoning behind
   the plan (`core/scripts/lib/steps/aide-analyze/references/plan-review.md`):
   three reviewers, in parallel, each with one perspective and no sight of the others' findings, whatever the spec's
   complexity. A tool with no way to start a subagent runs the same reviews one after the other in its own session.
   With a Review under Analyze chosen, the session hands the review over instead: the runner runs the three reviewers
   in a fresh read-only session on that AI and model, and gives their findings back to the analyze session.
6. The same session corrects the plan from the findings and writes `4-status.md`. The runner reads only the counts on
   the plan review's `**Findings:**` line.

#### The complexity grade

The analyze session grades the spec LOW, MEDIUM or HIGH itself, once it has searched the code. No person sets the
grade, and the runner does not check it.

- **What decides it:** the risk of the change, judged from the code. The criteria, with two worked examples, are in
  `core/scripts/lib/steps/aide-analyze/references/complexity-and-analysis.md`, and nowhere else.
- **What it decides:**
  - how deep the analysis goes, and how long `2-analysis.md` is;
  - whether the plan comes in phases, for HIGH.

  It does not decide the plan review: that always has three reviewers, since the grade is the analyst's own.

### Implement

1. The runner starts one new session with `aide-implement`, which writes the code and its tests. With
   [`resumeAnalysis`](#settings) on, it continues the analysis's own session instead. In Aide's own repository the
   session also photographs the dashboard pages its change affects, at a desktop and a phone width, into a folder the
   runner names beside the step's log; the job page links them under Screenshots, and the review is shown them.
2. **The review.** The runner starts a second, new session (`run-spec/turn/review.sh`), on the spec's Review choice,
   then the Models per phase choice, Codex included, else the step's own. It reads the description, finds the branch's
   whole change against where it left the default branch with `git diff` itself, and reports defects against the
   description. It changes nothing.
3. **The verification**, when the spec's or Models per phase's Verify choice names a model. A third new session traces each defect in the code and
   keeps or drops it. Only the kept ones go on.
4. Defects found go back to the implement session as one more turn, which fixes them, or turns down one it shows is
   not a defect. The review does not run again.
5. The runner runs the tests itself (`run-spec/turn/step-tests.sh`). Red goes back to the implement session, with the
   failing lines, for up to two more turns.
6. The step ends only on a green run the runner made itself.

No subagents.

### Held back

No AI. A person ticks the acceptance criteria, and can try the change on the test server first.

### Archive

1. When the spec cannot be archived yet, such as acceptance criteria still unticked, the runner says so and no AI runs.
2. Otherwise the runner starts one new session with `aide-archive`. It merges the default branch in, resolves any
   conflict and moves the spec to `archive/`.
3. The landing runs the project's tests on the merge and merges the branch into main. When tests the branch broke
   fail on the merge and pass on main alone, the landing starts a new session to fix them on the branch, at most twice
   (`dashboard/src/serve/land-branch/repair/`), then rebuilds the merge and tests it again.

No subagents and no review.

### Close and Reopen

- **Close** runs one new session with `aide-close`, which records why the spec is closed.
- **Reopen** runs no AI: a script moves the spec back, keeping its files or resetting them.

### Merge

Merge to main lands a branch that belongs to no spec (`aide land`), with the same test gate as an archive.

1. A merge conflict starts a new session that may edit only the conflicted files, at most twice per repository. The
   board checks the result and commits the merge itself.
2. Red tests on the merge get the same repair sessions as Archive, at most twice.

The repair sessions run on the AI and model Implement would use.

## The loops

Every loop that sends work back has an end:

- **After the review in Implement:** at most one turn to fix what the review found.
- **After red tests in Implement:** at most two more turns, each within what is left of the step's time limit. Once
  the implement session has used `AIDE_TEST_FIX_FRESH_PERCENT` of its context window, a fresh session of the same
  AI and model takes over the test fixes and keeps them for later rounds.
- **After the plan review in Analyze:** inside the same session, once.
- **After red tests on a landing (Archive and Merge):** at most two repair sessions, and only for tests that pass on
  main alone.
- **After a merge conflict in Merge:** at most two repair sessions per repository.
- **Inside every session:** the agent's own loop of reading, changing and checking, until it answers without asking for
  another tool. The step's time limit is what ends it.

## Settings

- **`resumeAnalysis`** in the board's queue file: an implement continues its analysis's own session, when both ran with
  the same AI and the analysis ended within the hour. Off unless set
  ([running specs](../dashboard/docs/running-specs.md)).
- **`AIDE_TEST_FIX_ROUNDS`**: how many more turns red tests get. 2 unless set.
- **`AIDE_TEST_FIX_FRESH_PERCENT`**: how full the implement session may be before red tests go to a fresh session of
  the same AI and model. 85 unless set. When the AI states no context figure, the implement session keeps the fixes.
- **`AIDE_TEST_RUN_LIMIT_SEC`**: how long one of the runner's own test runs may take. An hour unless set; the step's
  own time limit does not count it.
- **The AI, model and effort for each step**, chosen per spec. Review and Verify can also be chosen per spec; otherwise
  they use Models per phase, with Implement's own model and no verification as their final defaults. Review under
  Analyze can be chosen the same way; without a choice the analyze session reviews on its own model.

## What Aide does not do

- One flow for every kind of task: a bug fix, a refactor and a new feature go through the same steps.
- Several agents writing parts of one spec at the same time.

Ideas for each of these are in [the roadmap](ROADMAP.md), under "A flow suited to the kind of task" and "More than one
way to run a step".
