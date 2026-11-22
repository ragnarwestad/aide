Run this repository's (Aide's) whole test suite on main and record what it
said. Nobody is watching. Fix a red test yourself only when the test is what
is wrong and the fix stays inside test files; propose one spec for every
other red test; then stop.

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

## Step 2 of 4: Fix a red test whose test is wrong

For each red test, read the test and the code it tests, and decide where
the cause lies.

Fix it yourself only when all of these hold:
- the cause is in the test: a time limit too short for the machine, a test
  that depends on another test's leftovers or on the order the tests run
  in, a fixture that no longer matches what the code is meant to do, a
  wrong path or name in the test;
- the fix changes test files only (`core/tests/`, `dashboard/test/` and
  the helpers there), nothing the tests test;
- the fix keeps everything the test checks: no assertion removed or
  loosened, no test skipped, marked to be skipped, deleted or renamed
  away, no retry added around it.

When you fix one, run that test file on its own and see it green, then
commit it with a message in English, in the imperative, saying what was
wrong with the test. One commit per test file. Never commit anything
outside test files.

Every other red test — the cause is in the code, you are not sure where
it lies, or the fix would need to touch anything but a test — is left as
it is and goes into the spec in Step 4.

## Step 3 of 4: Write the report

Write the result to `$AIDE_SCHEDULE_OUTPUT_DIR/index.html` — that
directory is this run's own directory, and the file is what the entry's
page shows as the run's report. Plain HTML, no styling:
- a first line saying green or red, with the commit tested
  (`git rev-parse --short HEAD` before your own commits),
- one line per part with its pass and fail counts,
- the name of every red test, each with the assertion lines underneath
  it, and whether you fixed it (with the commit's subject) or left it for
  the spec,
- under its own heading, every unstable test: one that failed first and
  passed when run again, with its file,
- each red part's last 50 lines of output at the bottom, in a `<pre>`.

If a part could not run at all — no browser, no dependencies, a crash
before the first test — say that in the same file instead, with what the
command printed. A missing report reads as "nothing happened"; an honest
"it could not start" does not.

## Step 4 of 4: Propose one spec for the red tests you did not fix

When at least one red test is left unfixed, propose one spec that covers
every such test file, unless an earlier one is still open: look through
the titles in the specs folder that `AIDE_SPECS_PATH` in `.aide/config`
names, leaving out `archive/`, and propose nothing when a title starts
with `Make the tests green on main`.

Write the proposal to `$AIDE_SCHEDULE_OUTPUT_DIR/proposed-specs.json`, a
JSON list holding one object with a `title` and a `description`:
- `title`: `Make the tests green on main (<YYYY-MM-DD>)`, with today's
  date.
- `description`: a `## Problem` section naming the commit tested and,
  for each red test file left unfixed, the failing tests, their assertion
  lines and where you think the cause lies; a `## Solution` section
  saying the tests pass on main again, with each cause fixed where it
  lies — in the code, or in the test when the test is what is wrong; and
  an `## Acceptance criteria` section with `- **AC-1:**` lines, each one
  sentence. Under 4,000 characters.

Write no file when no red test is left unfixed, or when an earlier spec is
still open.
