# Agents and loops

## Table of contents

- [The strategy](#the-strategy)
- [Two kinds of agent](#two-kinds-of-agent)
- [Step by step](#step-by-step)
  - [Create](#create)
  - [Analyze](#analyze)
  - [Implement](#implement)
  - [Held back](#held-back)
  - [Archive](#archive)
  - [Close and Reopen](#close-and-reopen)
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
  back to the agent that wrote the work.
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
2. The session reads the description and the code, and writes `2-analysis.md` and the plan in `3-solution.md`, with
   more than one approach when the spec asks for a choice and the approaches really differ.
3. **The plan review.** The session starts subagents that read only the spec's four files, never the reasoning behind
   the plan (`core/skills/aide-analyze/references/plan-review.md`):
   - a LOW spec gets one reviewer;
   - a MEDIUM or HIGH spec gets three, in parallel, each with one perspective and no sight of the others' findings.

   A tool with no way to start a subagent runs the same reviews one after the other in its own session.
4. The same session corrects the plan from the findings and writes `4-status.md`. The runner reads only the counts on
   the plan review's `**Findings:**` line.

### Implement

1. The runner starts one new session with `aide-implement`, which writes the code and its tests. With
   [`resumeAnalysis`](#settings) on, it continues the analysis's own session instead.
2. **The review.** The runner starts a second, new session, with the same AI, model and effort
   (`run-spec/turn/review.sh`). It reads the description, finds the branch's whole change against where it left the
   default branch with `git diff` itself, and reports defects against the description. It changes nothing.
3. Defects found go back to the implement session as one more turn, which fixes them. The review does not run again.
4. The runner runs the tests itself (`run-spec/turn/step-tests.sh`). Red goes back to the implement session, with the
   failing lines, for up to two more turns.
5. The step ends only on a green run the runner made itself.

No subagents.

### Held back

No AI. A person ticks the acceptance criteria, and can try the change on the test server first.

### Archive

1. When the spec cannot be archived yet, such as acceptance criteria still unticked, the runner says so and no AI runs.
2. Otherwise the runner starts one new session with `aide-archive`. It merges the default branch in, resolves any
   conflict, updates the project's wiki and moves the spec to `archive/`.
3. The landing runs the whole suite and merges the branch into main. That is the board's own code, not an agent.

No subagents and no review.

### Close and Reopen

- **Close** runs one new session with `aide-close`, which records why the spec is closed.
- **Reopen** runs no AI: a script moves the spec back, keeping its files or resetting them.

## The loops

Every loop that sends work back goes to the session that did the work, and every one has an end:

- **After the review in Implement:** at most one turn to fix what the review found.
- **After red tests in Implement:** at most two more turns, each within what is left of the step's time limit.
- **After the plan review in Analyze:** inside the same session, once.
- **Inside every session:** the agent's own loop of reading, changing and checking, until it answers without asking for
  another tool. The step's time limit is what ends it.

## Settings

- **`resumeAnalysis`** in the board's queue file: an implement continues its analysis's own session, when both ran with
  the same AI and the analysis ended within the hour. Off unless set
  ([running specs](../dashboard/docs/running-specs.md)).
- **`AIDE_TEST_FIX_ROUNDS`**: how many more turns red tests get. 2 unless set.
- **The AI, model and effort for each step**, chosen per spec. The review in Implement always uses the step's own.

## What Aide does not do

- One flow for every kind of task: a bug fix, a refactor and a new feature go through the same steps.
- A review by another model than the one that wrote the code.
- Several agents writing parts of one spec at the same time.

Ideas for each of these are in [the roadmap](ROADMAP.md), under "A flow suited to the kind of task" and "More than one
way to run a step".
