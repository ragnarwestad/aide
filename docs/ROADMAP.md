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
  - [One project, several code repositories](#one-project-several-code-repositories)

---

Ideas we want to weigh for Aide, and where each one stands. What Aide does today is in its own documentation, the
specs and the git history, not here.

## How an idea is kept here

Each idea says where it came from, what it is, and why it might be worth doing, at the level of a goal rather than
a design. An idea decided against is taken off the page.

An idea that becomes a spec names it, and leaves this page once the spec is archived.

## To consider

### A commit body that says what was wrong and what stays unchanged

From [OpenGeni](https://github.com/Cloudgeni-ai/opengeni): a fix's commit says what was wrong, why, what it meant for
a user, and what deliberately does not change, so the next reader does not undo something that was intended.

### One map of the system, updated in the same change

From OpenGeni: one map of how the system is built, kept current by the same change that alters it, since "a stale map
is a bug". Aide has most of the map in its documentation table and the wiki; the rule that keeps it current is
missing.

### A run that can ask a question and wait for the answer

From OpenGeni: a run that meets something unclear asks, and carries on once it has the answer, instead of guessing or
stopping. Aide has this for two fixed questions; the goal is a run that can ask anything.

### An append-only event log for runs

From OpenGeni: every event of a run is kept in order, so any view, a reload or an audit can replay what happened.
Aide keeps each job's latest state, so a run's history cannot be replayed.

### The spec-structure rule describes how specs are written now

From comparing Aide's specs with the sources in `docs/SPEC_WRITING_SOURCES.md`: the rule for the spec files should
describe a spec as it is written today, throughout.

### The plan review checks the scenarios and the test list

From the same comparison: the plan review holds a plan's scenarios to the criteria they come from, and its tests to
the testing rules.

### A Claude Code mod that shows the board in a session

From Claude Code's mods: the board's work shown inside the session working on Aide.

### Aide's skills as a Claude plugin

From "Build plugins for Claude" and the Claude Marketplace: a second way to deliver Aide's skills to Claude users,
beside the installer that also serves Codex, OpenCode and Copilot.

### Correct the spec, not the code

From Felipe Fontoura's [case study](https://felipefontoura.com/articles/spec-driven-development-case-study/): a wrong
result is fixed in the spec and run again, never patched in the code while the spec says something else.

### Keep an archived spec's tests from disappearing unnoticed

From weighing how OpenSpec keeps its specs true: an archived spec's criteria stay proven over time, so a later change
cannot remove or weaken the test behind one without anyone being told.

### A review that also holds the code to the repo's own rules

From Matt Pocock's [`code-review`](https://github.com/mattpocock/skills/tree/main/skills/engineering/code-review)
skill: the review after an implement checks the code against the repo's own written rules as well as against the
spec, and says what is missing, what nobody asked for, and where each finding comes from.

### One project, several code repositories

A system is often a frontend and one or more backends: one spec that changes all of a project's code repositories
in the same run, each landing through its own pull request. Worth doing once there is a real system with several
repositories to try it on.
