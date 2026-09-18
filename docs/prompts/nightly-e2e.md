Run the dashboard's browser tests for this repository (Aide) and record what
they said. Nobody is watching, so do not fix anything and do not commit:
report, and stop.

1. From `dashboard/`, run `bun test --timeout 20000 test/e2e`. If it fails
   because Chromium is missing, run `bunx playwright install chromium` once
   and run the suite again.
2. Write the result to `$AIDE_SCHEDULE_OUTPUT_DIR/index.html` — that directory
   is this run's own directory, and the file is what the entry's page shows
   as the run's report. Plain HTML, no styling:
   - a first line saying green or red, with the pass and fail counts,
   - the name of every test that failed, each with the assertion lines
     underneath it,
   - the whole run's last 50 lines of output at the bottom, in a `<pre>`.
3. If the suite could not run at all — no browser, no dependencies, a crash
   before the first test — say that in the same file instead, with what the
   command printed. A missing report reads as "nothing happened"; an honest
   "it could not start" does not.
4. Change no file in the repository, and commit nothing.
