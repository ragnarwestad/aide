Run this repository's (Aide's) whole test suite on main and record what it
said. Nobody is watching, so do not fix anything and do not commit: report,
propose one spec for what is red, and stop.


## Step 1 of 3: Run the test suites

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
unstable, not red.

## Step 2 of 3: Write the report

Write the result to `$AIDE_SCHEDULE_OUTPUT_DIR/index.html` — that
directory is this run's own directory, and the file is what the entry's
page shows as the run's report. Plain HTML, no styling:
- a first line saying green or red, with the commit tested
  (`git rev-parse --short HEAD`),
- one line per part with its pass and fail counts,
- the name of every red test, each with the assertion lines underneath
  it,
- under its own heading, every unstable test: one that failed first and
  passed when run again, with its file,
- each red part's last 50 lines of output at the bottom, in a `<pre>`.

If a part could not run at all — no browser, no dependencies, a crash
before the first test — say that in the same file instead, with what the
command printed. A missing report reads as "nothing happened"; an honest
"it could not start" does not.

## Step 3 of 3: Propose one spec for the red tests

When at least one part is red, propose one spec that covers every red
test file, unless an earlier one is still open: look through the titles in
the specs folder that `AIDE_SPECS_PATH` in `.aide/config` names, leaving
out `archive/`, and propose nothing when a title starts with
`Make the tests green on main`. Unstable tests are never proposed.

Write the proposal to `$AIDE_SCHEDULE_OUTPUT_DIR/proposed-specs.json`, a
JSON list holding one object with a `title` and a `description`:
- `title`: `Make the tests green on main (<YYYY-MM-DD>)`, with today's
  date.
- `description`: a `## Problem` section naming the commit tested and,
  for each red test file, the failing tests and their assertion lines; a
  `## Solution` section saying the tests pass on main again, with each
  cause fixed where it lies — in the code, or in the test when the test
  is what is wrong; and an `## Acceptance criteria` section with
  `- **AC-1:**` lines, each one sentence. Under 4,000 characters.

Write no file when no part is red, or when an earlier spec is still open.

Change no file in the repository, and commit nothing.
