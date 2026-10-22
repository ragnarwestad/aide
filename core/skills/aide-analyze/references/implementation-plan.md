# The implementation plan: what a full analysis writes in 3-solution.md

## Table of contents

- [Scope](#scope)
- [Approaches](#approaches)
- [Behavior delta](#behavior-delta)
- [Parts](#parts)
- [Risk analysis](#risk-analysis)
- [Acceptance criteria](#acceptance-criteria)
- [The test command](#the-test-command)
- [Where the tests sit](#where-the-tests-sit)
- [The TDD tasks](#the-tdd-tasks)

---

## Scope

**Scope:** the files to change, the complexity grade with each factor that
set it and the files that show it (Step 3), and the estimate for manual and
AI-assisted development.

## Approaches

**Approaches:** when the spec asks to choose the approach (Step 1), every
approach lead ends in one of three marks, letters A, B, C in order, as the
spec structure shows: `(recommended)` on exactly one, `(real alternative)`
on each other approach a person could reasonably pick instead, and
`(considered and rejected)` on one that fails a requirement or is plainly
worse. The Specs list offers the person every approach marked recommended
or real alternative, so an approach left unmarked is never offered
(`references/spec-files.md` has the format and the chosen line). When
the spec does not ask, only the recommended lead carries a mark. Never write or remove a
`**Chosen approach:**` line: the dashboard writes it.

## Behavior delta

**Behavior delta:** state what the chosen solution ADDS / MODIFIES / REMOVES
in behavior, relative to how the system works today — not just which files
change (those are listed under Scope).

## Parts

**Parts:** a `### Parts` subsection under Recommended solution, with one
line for every part the change needs that it does not have yet (Step 2):

    - **<the part>** — Reused: <what, with file:line>
    - **<the part>** — New, because <why nothing existing does it>

A New reason names what was looked at and why it does not do the job. A
change that needs no part of its own writes the one line
`- None — <why>`, so an empty list is never mistaken for a forgotten one.

## Risk analysis

**Risk analysis:** the risks the chosen solution carries, each with
consequence, probability and mitigation.

## Acceptance criteria

**Acceptance criteria:** testable given/when/then scenarios. Each criterion
must be verifiable by a test — if you cannot phrase the test, the criterion
is too vague. When AC-n ids exist, see `references/requirements-tracing.md`
for how each criterion opens with the AC-id it covers.

Unless the level is `off`, a criterion with a WHEN, WHILE or WHERE
condition, wherever the condition is written, also gets a scenario for
the case where that condition does not hold: what the system does then.

End a criterion with *(browser)* when only a real browser can answer it:
whether something is displayed, where it sits on the screen, what
scrolls, what moves when its text changes. What the markup or the
stylesheet says is not a browser question, and a criterion without the
tag is tested the ordinary way. `/aide-implement` writes a browser test
for every tagged criterion.

## The test command

**Name the project's test command.** `aide-resolve-test-cmd --project-dir .`
prints it (the manifest's `AIDE_TEST_CMD`, the tools-and-scripts skill,
"Project commands"). Write it into the plan verbatim — never leave the
`<project test command>` placeholder standing.

## Where the tests sit

**Where the tests sit:** a `### Where the tests sit` subsection under
Testing, one line per place: the public interface where the behaviour is
observed, its test file, whether that file exists, and the rules tested
there (the AC-ids). As few places as cover the criteria, and a new place
only where no existing test file observes the behaviour — the testing
rule's "One place per rule", decided before any test is written. A
criterion no test can reach gets no place: the Manual testing note says
why.

    - **<public interface>** in `<test file>` (existing|new) — <AC-ids, or the rule in words>

## The TDD tasks

Structure the plan with TDD:
- Task 0: Write tests (RED phase) — at least one failing test per acceptance criterion with a place, at the places Where the tests sit names
- Task 1-N: Implementation (GREEN phase)
- Testing strategy (VERIFY phase)

Call a plan item a task, never a step: a step is what the queue runs, or
a numbered section of a skill such as this one, and a log that says
"Step 8" must mean one of those.
