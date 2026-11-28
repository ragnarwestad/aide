Run this repository's (Aide's) whole test suite on main and record what it
said. Nobody is watching. Fix every red test you can, in the test or in the
code, wherever the cause lies; write a spec text into the report for each
one you cannot fix; then stop.

You work on a branch of your own. What you commit, the board merges after
this run, and only once the repository's test command is green on the merge.


## Step 1 of 4: Run the test suites

Run the suite in three parts, from the repository root, each with a
20-minute timeout and each run even when an earlier part failed. Put
mise's shims first on PATH, as the project's test command does:
`export PATH="$HOME/.local/share/mise/shims:$PATH"`.
- `scripts/test-python`
- `cd dashboard && make test`
- `cd dashboard && make test-e2e`. If it fails because Chromium is
  missing, run `bunx playwright install chromium` once and run it again.

A part is red only when its command exits non-zero. Each part runs a
failing test once more on its own and counts only a second failure, so a
test can fail first and still leave its part green: that test is
unstable, not red. Unstable tests are reported, never fixed or proposed.

A test that fails because this run was not allowed to do something —
`Operation not permitted`, `EPERM`, a browser or a program that was
refused at start — could not run here. It is reported as such, under its
own heading, and is never fixed or proposed: the merge runs it where it is
allowed.

## Step 2 of 4: Fix the red tests

For each red test, read the test and the code it tests, and decide where
the cause lies: in the test (a time limit too short for the machine, a
test that depends on another test's leftovers or on the order the tests
run in, a fixture that no longer matches what the code is meant to do, a
wrong path or name) or in the code the test checks.

Fix it where the cause lies, when you are sure of the cause and the fix
keeps everything the test checks: no assertion removed or loosened, no
test skipped, marked to be skipped, deleted or renamed away, no retry
added around it, and no behaviour another test relies on changed.

When you fix one, run that test file on its own and see it green, and run
the test files that cover any code you changed. Then commit, with a message
in English, in the imperative, saying what was wrong. One commit per
cause.

A red test whose cause you are not sure of, or whose fix would change what
the code is meant to do, is left as it is and goes into the spec text in
Step 4.

## Step 3 of 4: Write the report

Write the result to `$AIDE_SCHEDULE_OUTPUT_DIR/index.html` — that
directory is this run's own directory, and the file is what the entry's
page shows as the run's report. Plain HTML, no styling:
- a first line saying green or red, with the commit tested
  (`git rev-parse --short HEAD` before your own commits),
- one line per part with its pass and fail counts,
- the name of every red test, each with the assertion lines underneath
  it, and whether you fixed it (with the commit's subject) or left it for
  the spec text,
- under its own heading, every unstable test: one that failed first and
  passed when run again, with its file,
- under its own heading, every test that could not run here, with the
  line that says what was refused,
- each red part's last 50 lines of output at the bottom, in a `<pre>`.

If a part could not run at all — no browser, no dependencies, a crash
before the first test — say that in the same file instead, with what the
command printed. A missing report reads as "nothing happened"; an honest
"it could not start" does not.

## Step 4 of 4: Write a spec text for the red tests you did not fix

When at least one red test is left unfixed, add a section headed
`Proposed spec` at the end of the report, for a person to read and decide
whether a spec is needed. It holds one spec text covering every such test
file:
- a title: `Make the tests green on main (<YYYY-MM-DD>)`, with today's
  date;
- a description, in a `<pre>` so it can be copied as Markdown: a
  `## Problem` section naming the commit tested and, for each red test
  file left unfixed, the failing tests, their assertion lines and where
  you think the cause lies; a `## Solution` section saying the tests pass
  on main again, with each cause fixed where it lies; and an
  `## Acceptance criteria` section with `- **AC-1:**` lines, each one
  sentence. Under 4,000 characters.

Write no `proposed-specs.json`: nothing from this run becomes a spec by
itself.
