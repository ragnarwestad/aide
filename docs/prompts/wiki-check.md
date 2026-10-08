Check this repository's wiki (Aide's) against the code and the docs, and report
every generated page that says something they contradict. Nobody is watching,
so do not fix anything and do not commit: report, and stop.

1. Find the specs root the way the skills do: `AIDE_SPECS_PATH` in this
   worktree's `.aide/config`, or `specs/` when the file names none. The wiki
   is the folder `wiki/` inside it. If there is no `wiki/`, say so in the
   report (step 4) and stop.
2. Run `aide-wiki status --specs-root <specs root> --project-dir .` to list
   the pages. Use its generated
   mark, never a mark quoted in a page's body. Run each filter with `jq -r` over the
   answer. The pages to check:

   ```jq
   .pages[] | select(.generated) | .page
   ```

   The pages to skip, and only these:

   ```jq
   .pages[] | select(.generated | not) | .page
   ```

3. For each generated page, read the files it names in its `files:` list as
   they are now, and every page under `docs/` it links to or names. Judge only
   what the page states as fact: what a file does, a name, an order of steps, a
   rule, what calls what. A page disagrees when a statement of that kind is
   contradicted by the file or the doc it names. A page that leaves something
   out, or reads dated, does not disagree; a statement you cannot tie to a
   file or a doc is not judged.
4. Write the result to `$AIDE_SCHEDULE_OUTPUT_DIR/index.html` — that
   directory is this run's own directory, and the file is what the entry's
   page shows as the run's report. Plain HTML, no styling:
   - a first line saying how many of the pages checked disagree, or that
     nothing disagrees, and how many pages were checked (the pages to check
     less the ones you could not check),
   - for each page that disagrees: the page's name, then what the page says
     and what the code or the doc says, each quoted word for word with the
     path of the file or the doc it comes from,
   - the pages you could not check, each with why (a named file is missing, a
     file could not be read), listed apart from the ones that agree, so a page
     you did not check never reads as agreeing,
   - the pages skipped: the hand-written pages the second filter printed.
5. Change no file in this repository or in the specs repository, and commit
   nothing.
