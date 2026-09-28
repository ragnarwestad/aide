# Tests in a spec

## Table of contents

- [When the tests run](#when-the-tests-run)
- [Which tests run](#which-tests-run)
- [What the AI is told about tests](#what-the-ai-is-told-about-tests)
- [What you see on the board](#what-you-see-on-the-board)
- [Aide's own suite](#aides-own-suite)

---

When a project's tests run while a spec goes through the board, who runs them, and what happens when they are red.
The same holds for every project the board runs; the last section is about Aide's own suite.


## When the tests run

A phase has two parts: the AI, which does the work, and Aide itself, which starts the AI and checks what it left.
Both can run the tests.

| Phase           | The AI                                                                    | Aide itself                                                                                                                                          | When it is red                                                                                                                                                                                              |
|-----------------|---------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| create, analyze | none                                                                      | none                                                                                                                                                 | —                                                                                                                                                                                                           |
| implement       | the test files it is working on; the full suite once, after its last fix  | the full suite once, after the AI is done — not again when the AI already recorded a green run of exactly the code it delivered                      | the failing lines go back to the same AI, which fixes them, and Aide runs the suite again: at most two such rounds, within the step's time limit. Still red: the step fails, and Implement is offered again |
| archive         | only the tests covering files it touched while resolving a merge conflict | the full suite once, in the landing, on exactly what the default branch is about to become — not when implement's green run covers exactly that code | the whole suite runs once more (not after a timeout). Green then: it lands, marked "merged after a retry". Red twice: nothing reaches the default branch, the spec's branch is kept, and the job stops      |
| close, reopen   | none                                                                      | none                                                                                                                                                 | —                                                                                                                                                                                                           |

A run that is still going when the step's time limit runs out is stopped, and the step ends on its time limit with
the work so far committed. The landing is described in full in [landing.md](landing.md).

---

## Which tests run

Aide runs one command, the same in implement and in the landing: `AIDE_TEST_CMD` in the project's
`.aide/project.yaml`, set from the project's Settings. Nothing else is read and nothing is guessed. It runs the project's whole suite
whatever the change touched; aide's own runs pytest, `make test` and the browser tests (`make test-e2e`).

The one exception is a change to Markdown files and nothing else, compared with the default branch: it runs the
project's `scripts/check-docs` when it has one, and nothing when it does not. A paragraph cannot turn the suite red.

An implement's own run asks for four workers (`AIDE_TEST_WORKERS`, and `PYTEST_XDIST_AUTO_NUM_WORKERS` for pytest's
`-n auto`), so two specs' suites can share the machine with the board.

A project without `AIDE_TEST_CMD` has nothing to run, and passes. Its page says there is no test command.

---

## What the AI is told about tests

The rules the AI follows are in `core/rules/testing.md`, installed for every AI tool Aide supports and read in every
project. In short:

- Every change ships with its test, and a bug fix with a test for that bug; the fix is reverted once to see that
  exactly that test goes red.
- A test proves a rule, not the rendering: one place per rule, layout measured in a browser rather than read out of
  the stylesheet, no test that pins the wording of a text, one language for a translated word.
- A change that replaces behaviour deletes the tests for what it replaced.
- A red full run is fixed file by file, running only the file at hand, and the full suite runs again once, when
  every file is green. A test that fails in the full run and passes on its own is the machine's load, not a fault.

`/aide-implement` adds its own: at least one test per acceptance criterion, with the criterion's AC-id in the test's
name, and none for a criterion an existing test already proves — that test gets the id in its name instead.

---

## What you see on the board

- **While the tests run:** when Aide runs them, after implement and in the landing, the step's Log shows how far
  they have come as it happens, each line starting `tests:`:
  - the command that started
  - pytest's percentage every tenth, and its summary
  - each worker of a spread suite as it ends, and the total

  The whole output is kept beside the step's run log as `<job id>.<step>.tests.log`. A run the AI makes itself
  shows in the Log only when it has ended.
- **Implement red:** the step has failed, and the failing test lines are on the spec's row. Press Implement again.
- **Landing red:** an amber message, not a red one — the change was built and merged locally, and what is missing is
  a green suite. The failing lines are on the row. The usual cause is another spec that landed in the meantime; run
  Implement again, then Archive.
- **Red on main as well:** the landing ran the same tests on the default branch without the spec, and they were red
  there too. The failure is main's; nothing about the spec needs changing. Press Archive again once main is green.
- **Merged after a retry:** the landing's first run was red and the second green. The job keeps the lines that
  failed the first time, so a test that fails now and then can be found.

Acceptance criteria are a separate thing from the tests: those are the boxes you tick on the Status tab or under the
row, usually after trying the change on a [test server](test-server.md).

---

## Aide's own suite

For whoever changes Aide itself.

- `make test` under `dashboard/` type-checks first, then deals the test files out over one bun process per core
  (`scripts/run-tests.sh`). A process stopped by a signal with no failing test is run once more; only a second
  failure turns the suite red.
- Every `bun test` process and every pytest process works in a temp directory of its own, removed when it ends, so
  a test that forgets its directory leaves nothing in the machine's shared one.
- `test/round/run` starts a throwaway board from the round's own sample specs. It stays out of `make test`
  (`make test-slow` runs it), and a new round removes earlier rounds' directories that no running board uses.
