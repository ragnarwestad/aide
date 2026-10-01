# Testing rules for AI-assisted development

## Table of contents

- [Every change ships with its test](#every-change-ships-with-its-test)
- [Replaced behaviour takes its tests with it](#replaced-behaviour-takes-its-tests-with-it)
- [Core rule](#core-rule)
- [Test commands](#test-commands)
  - [Unit tests](#unit-tests)
  - [E2E tests (Playwright)](#e2e-tests-playwright)
- [Red, green, refactor](#red-green-refactor)
- [Single-run mode, never watch mode](#single-run-mode-never-watch-mode)

---

## Every change ships with its test

**Fix a bug or add functionality → write the test in the same job. Never as a suggestion
afterwards, never as an item on a list of outstanding work.**

The user has to ask for this far too often. The pattern to stop: deliver the code, then offer tests
as a separate follow-up, or list "this has no test coverage" as an outstanding action. Tests are
part of the delivery, like the code compiling.

### What to test

- **The rule, not the rendering.** What would break silently, in a way nobody sees for weeks. Not the
  markup — a test that restates the HTML raises a number and catches nothing.
- **A bug fix gets a test for the bug.** The failure that was reported is the test case.
- **One place per rule.** A rule is proven where it lives — the store, the parser, the helper. A
  route or page test proves only that it is wired to that rule, once, not every case again.
- **No layout tests.** A test does not check how a page looks or where a component sits: no markup,
  no CSS, no class names, no element order, no widths or positions, in unit tests or browser tests
  alike. What a page computes — which state a row is in, which action it offers — is logic, and is
  tested on the function that decides it, not on the HTML it renders. A browser test is for
  behaviour that only a browser has: a click that starts an action, a live update that arrives.
- **No wording pins.** A test does not assert a sentence of a rule, skill, doc or help text. It
  asserts what code depends on: a name a script calls, a format a parser reads, a copy that must
  equal its source.
- **One language proves the catalogue.** A test that the page reads a translated word needs one
  language, not one per language.

### Prove the test is worth having

**Revert the fix temporarily and confirm that exactly that test goes red.** A test that passes both
with and without the fix is decoration. This takes thirty seconds and is not optional for a bug fix.

### When a unit test genuinely cannot reach it

Some things only exist in a browser: shadow-DOM internals, anything that depends on where the
camera is pointing, real rendering. Say so plainly, put it in the Playwright suite instead, and say
which spec — but never leave the change with nothing at all.

---

## Replaced behaviour takes its tests with it

**A change that replaces behaviour deletes the tests for the behaviour it replaced, in the same
job.** A suite only grows if nothing ever leaves it, and what is left behind is worse than noise:
a test named for a control that no longer exists tells the next reader that the control is still a
concern.

What goes:

- A test whose subject is gone — the removed heading, the replaced field, the deleted page.
- A check that something removed is still absent, once the thing that replaced it is checked in the
  same test. `expect(html).not.toContain('<h3>Config</h3>')` beside an assertion on the tab that
  replaced the heading proves nothing the positive one does not.
- The comment that only dates the removal. Git says when; the test says what holds now.

What stays: a check where the absence IS the rule, with nothing having replaced it — no colour
literal outside the token block, no confirm field on a form that asks in a sentence, no English
label on a Norwegian page.

A test left red by the change is not covered by this: fix it or delete it deliberately, and say
which in the summary.

---

## Core rule

Run a test as soon as you create or modify it, and verify it passes before moving on.

**E2E tests (Playwright) have their own rules** — see [E2E tests (Playwright)](#e2e-tests-playwright);
run them only in projects on the quick-suite list kept there, and ask the user elsewhere. Everything
below about running tests applies to unit tests.

1. Run the new or changed test immediately.
2. Verify that it passes (green ✅). If it fails (red ❌), analyze the error message, fix the
   problem — either the test or the code — and re-run until it passes.
3. Before committing, run the entire test suite to check for regressions.

### Slow tests never block the session

The job itself often takes seconds; verification must not turn that into a long wait while the
user does nothing else.

- Run in the foreground only fast, narrow test files that cover the exact change. Learn which files
  in a repo are slow before running anything broad.
- Run anything slow in the background, announced with what it is and roughly how long, while the
  job and the conversation continue. Report the result when it lands.
- Run the full suite exactly once per job, in the background, before commit — never inline, never
  repeated per iteration.
- When the user is waiting to see something, deploy or show it first and verify in the background.

### A red full run is fixed file by file

The full run finds what broke; it does not confirm each fix.

1. When it comes back red, list the failing files from that run's own output.
2. Fix them running only the file at hand (`bun test <file>`, `pytest <file>`) until each is green.
3. Run the full suite again once, when every file on the list is green — never between fixes.

A test that fails in the full run and passes on its own is the machine's load, not a fault: name it,
and do not run the full suite again for it.

---

## Test commands

### Unit tests

Use the project's own test command: `AIDE_TEST_CMD` in `.aide/project.yaml`, and nothing else (see
"Project commands" in the tools-and-scripts rules). Without it the project has no test command —
say so rather than guessing one. Always run it in single-run mode.

### E2E tests (Playwright)

**Run the e2e suite where the project's own run is quick and reliable. Keep that list explicit —
on this machine it is currently Atlasaurus (since 3 August 2026), PaceUp and Aide (since 27
September 2026). Elsewhere, ask the user to run it.**

**Aide: run `cd dashboard && make test-e2e` before every push to main**, whatever the change
touched — about 20 seconds. Otherwise only a landing runs it, and a browser test broken on main
stops the next spec's archive as if that spec had broken it. The one exception is a push that
changes only markdown files: no browser test reads them, and `scripts/check-docs` is their check.

The list stays short on purpose: a suite that hangs blocks the session for minutes with nothing to
show for it. Where a project's suite is fast, that risk is gone; where it still crawls, ask the
user to run it there instead.

Where it is allowed:

- Say what you are starting and roughly what it costs before launching it — the same courtesy as
  any open-ended job.
- Run it when a change touched interaction behaviour, not as routine after every edit; the
  project's ordinary check command stays the gate.
- Report the result plainly, failures included, with the output.
- Don't let it run unbounded: if a run overshoots what you told the user it would take, kill it,
  say so, and hand the suite back rather than sitting on it.
- Don't use the html reporter — it spawns a server that will not exit.
- Don't list an e2e run as an "outstanding action": the user runs the suite on their own
  initiative too, and reports when it goes red.

---

## Red, green, refactor

New functionality is written test first: a test that fails because the behaviour is missing
(red), then the least code that makes it pass (green), then the whole suite, to see nothing else
broke (refactor).

---

## Single-run mode, never watch mode

Run tests so the process exits when they are done: `vitest --run`, not `vitest`, and the same for
any runner with a watch or interactive mode (Jest, `gradle --continuous`, `cargo watch`, …). An AI
assistant cannot answer a watch mode, so the process stays open, has to be killed by hand, and
nobody can tell when the tests finished.

Kill only test processes you started yourself: find them with `ps aux | grep "[v]itest"` (or the
runner's own name) and `kill <PID>` — never `pkill -f node` or `pkill -f vitest`, which take every
matching process with them.
