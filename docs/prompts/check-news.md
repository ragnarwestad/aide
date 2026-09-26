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

Then write `$AIDE_SCHEDULE_OUTPUT_DIR/proposed-specs.json`: the specs this
review calls for. When this run ends green the board creates each one as a
spec; a person reads them and decides which to analyze and implement. The file
is a JSON list of objects with a `title` and a `description`:

    [{"title": "...", "description": "..."}]

Propose:

1. Exactly one spec that records this review in `docs/AI_NEWS_LOG.md` and
   stamps the version rows in `docs/AI_SUPPORT_MATRIX.md` by running
   `scripts/stamp-versions`. Its title names the period the review covers.
   Its description carries the log entry to write: the tool-by-tool tables
   for the period, as compact rows without padding to align the columns.
2. One spec for each finding that calls for a change in Aide — in
   `docs/AI_SUPPORT_MATRIX.md`, `.claude/skills/ai-tools-reference/SKILL.md`
   or elsewhere (an installer, a skill, a rule). Its title says the change.
   Its description quotes the finding as its source words it and lists the
   sources as links.

A finding that needs no change gets no spec. Write `[]` when nothing needs
proposing. A title is one line of at most 120 characters, and a description is
at most 4,000 characters.

The earlier runs' lists are in the sibling directories of
`$AIDE_SCHEDULE_OUTPUT_DIR` (`../*/proposed-specs.json`). For a finding you
proposed before, use exactly the title you used then: the board skips a
proposal whose title matches a spec that already exists, closed ones too. If
those files cannot be read, carry on without them.

Change no file in the repository. Do not run the stamp-versions script: the
spec you propose is what runs it. Commit nothing and push nothing.
