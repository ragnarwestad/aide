Run `/check-news` for this repository (Aide), headless, from the last review
date recorded in `docs/AI_NEWS_LOG.md` up to today.

Then, since nobody is here to approve anything:

1. Run `scripts/stamp-versions` so the "Supported versions" table in
   `docs/AI_SUPPORT_MATRIX.md` reflects the installed CLIs.
2. Do NOT edit `docs/AI_SUPPORT_MATRIX.md` or
   `.claude/skills/ai-tools-reference/SKILL.md` beyond that stamp. Put every
   proposed change to those two files into the new log entry's
   "Relevance for Aide" list instead, each as its own bullet starting with
   "Proposed:", so a user can approve them from the log.
3. Run `npx markdownlint-cli2 docs/AI_NEWS_LOG.md docs/AI_SUPPORT_MATRIX.md`
   and fix what it reports.
4. Commit the two files with the message
   `Log AI tool news for <last review date> to <today>` and push.
