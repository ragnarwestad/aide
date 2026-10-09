Run the `/aide-wiki` skill for this project, as a refresh: Steps 1 to 4, the
same as the Wiki tab's own Build button, rewriting only the pages
`aide-wiki status` marks changed, adding pages for any new part, and writing any page
`aide-wiki status` lists under `missing`. Mark each
of the skill's own numbered steps in your output the way its Workflow section
says.

This is a scheduled job, not a `wiki` step run from the Build button: it may
commit to the specs root under `wiki/`, and the board lands the work once
this run ends — do not run the skill's own Step 5, and do not merge anything
yourself. Touch nothing else in this repository or the project's own.
