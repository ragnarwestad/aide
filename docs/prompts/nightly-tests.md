Run this repository's (Aide's) whole test suite on main and record what it
said. Nobody is watching, so do not fix anything and do not commit: report,
propose a spec for each failure, and stop.

1. Run the suite in three parts, from the repository root, each with a
   10-minute timeout and each run even when an earlier part failed. Put
   mise's shims first on PATH, as the project's test command does:
   `export PATH="$HOME/.local/share/mise/shims:$PATH"`.
   - `scripts/test-python`
   - `cd dashboard && make test`
   - `cd dashboard && make test-e2e`. If it fails because Chromium is
     missing, run `bunx playwright install chromium` once and run it again.
2. Write the result to `$AIDE_SCHEDULE_OUTPUT_DIR/index.html` — that
   directory is this run's own directory, and the file is what the entry's
   page shows as the run's report. Plain HTML, no styling:
   - a first line saying green or red, with the commit tested
     (`git rev-parse --short HEAD`),
   - one line per part with its pass and fail counts,
   - the name of every test that failed, each with the assertion lines
     underneath it,
   - each red part's last 50 lines of output at the bottom, in a `<pre>`.
3. If a part could not run at all — no browser, no dependencies, a crash
   before the first test — say that in the same file instead, with what the
   command printed. A missing report reads as "nothing happened"; an honest
   "it could not start" does not.
4. For each test file with a failing test, propose one spec, unless an
   active spec already covers it: look through the titles in the specs
   folder that `AIDE_SPECS_PATH` in `.aide/config` names, leaving out
   `archive/`, and skip a file an active title already names. Write the
   proposals to `$AIDE_SCHEDULE_OUTPUT_DIR/proposed-specs.json`, a JSON list
   of objects with a `title` and a `description`:
   - `title`: `Make <test file> green on main (<YYYY-MM-DD>)`, with the test
     file's path from the repository root and today's date; the file's
     name alone when the path would take the title past 120 characters.
   - `description`: a `## Problem` section naming the failing tests, the
     commit tested and the assertion lines; a `## Solution` section saying
     the tests pass on main again, with the cause fixed where it lies — in
     the code, or in the test when the test is what is wrong; and an
     `## Acceptance criteria` section with `- **AC-1:**` lines, each one
     sentence. Under 4,000 characters.
   Write no file when everything is green.
5. Change no file in the repository, and commit nothing.
