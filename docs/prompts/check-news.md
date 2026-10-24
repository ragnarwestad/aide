Run Steps 1 to 4 of the `/check-news` skill for this repository (Aide),
headless, from the last review date recorded in `docs/AI_NEWS_LOG.md` up to
today: find the news, filter it, assess its relevance, and write the review
into the news log. Do not carry out Steps 5 and 6.

This runs every day, so most days bring little. Write a review into the news
log only when the period has at least one finding marked ⭐, ✅ or ⚠️, or a
watched page has changed. A period with nothing above ℹ gets no log entry and
no change to the log at all: its findings stay unreviewed, and the next run's
period starts from the same last review date, so nothing is lost.

Then run `scripts/stamp-versions`, which stamps the "Supported versions" table
in `docs/AI_SUPPORT_MATRIX.md` with what the installed CLIs report.

Change no other file in the repository. Commit nothing and push nothing: the
run commits what you changed, and the board lands it.

Write what you found to `$AIDE_SCHEDULE_OUTPUT_DIR/index.html` — that
directory is this run's own, and the file is what the entry's page shows as
the run's report. Plain HTML, no styling:

- a tool-by-tool table for the period (date, version, news, source), as the
  log's own entries have it,
- the "Relevance for Aide" list,
- a "To take up in a session" list: one numbered point for each finding that
  calls for a change in Aide — in `docs/AI_SUPPORT_MATRIX.md` beyond its
  version rows, `.claude/skills/ai-tools-reference/SKILL.md` or elsewhere (an
  installer, a skill, a rule, the runner). Each point says what to change and
  where, quotes the finding as its source words it, and links the sources.
  A finding that needs no change is not on it, and a period with none says so
  in one line,
- one line saying what was changed: the log entry's date, how many old reviews
  were deleted, and which version rows `scripts/stamp-versions` changed — or,
  when the period earned no log entry, that the log was left as it was, and
  why.

Fetch every address in the log's Sources table, each one, on every run: a
source is never skipped to save time, and a quiet source is still fetched. A
fetch that fails is named in the same file with what the fetch answered,
instead of being left out. "Not read" in the report means a fetch was tried
and failed, never that it was not tried.

Propose no specs: write no `proposed-specs.json`. The list is read and taken
up by a person in a session.
