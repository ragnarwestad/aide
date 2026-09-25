Run Steps 1 to 3 of the `/check-news` skill for this repository (Aide),
headless, from the last review date recorded in `docs/AI_NEWS_LOG.md` up to
today: find the news, filter it, and assess its relevance. Do not carry out
Steps 4 to 6.

Write what you found to `$AIDE_SCHEDULE_OUTPUT_DIR/index.html` — that
directory is this run's own, and the file is what the entry's page shows as
the run's report. Plain HTML, no styling:

- a tool-by-tool table for the period (date, version, news, source), as the
  log's own entries have it,
- the "Relevance for Aide" list, each proposed change to
  `docs/AI_SUPPORT_MATRIX.md` or `.claude/skills/ai-tools-reference/SKILL.md`
  as its own bullet starting with "Proposed:".

If a source could not be read, say so in the same file instead of leaving it
out.

Change no file in the repository. Do not run the stamp-versions script.
Commit nothing and push nothing.
