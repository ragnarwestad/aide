Run `/aide-untangle` on this whole repository (Aide), headless, using the three progress steps below. Skill steps
are instructions within these steps, not a second progress plan. Nobody is watching, so the area is the whole
repository and nothing is asked: change no file in the repository, commit nothing and push nothing.

## Step 1 of 3: Find the findings

Run Steps 2 to 5 of `/aide-untangle` on the whole repository: the size limits from `AGENTS.md`, "Code health",
every finding with a `file:line` you have read, the fixes above the findings they solve, and the check of the list
by a subagent. Keep the decision log in `$AIDE_SCHEDULE_OUTPUT_DIR/decision-log.md`.

Leave out a finding that an active spec already covers: look through the titles and descriptions in the specs
folder that `AIDE_SPECS_PATH` in `.aide/config` names, leaving out `archive/`.

## Step 2 of 3: Write the report

Write the result to `$AIDE_SCHEDULE_OUTPUT_DIR/index.html` — that directory is this run's own directory, and the
file is what the entry's page shows as the run's report. Plain HTML, no styling:

- a first line with the commit read (`git rev-parse --short HEAD`) and how many findings of each kind,
- one section per fix: what it is, the findings it solves with their `file:line`, and the spec text for it as
  Step 6 of `/aide-untangle` hands it over (Tittel, Beskrivelse and Avhengigheter), each in a `<pre>`,
- last, which fix you would start with and why.

When nothing is found, say so in the same file, with the commit read.

## Step 3 of 3: Stop

Create no spec and propose none to the board: the person reading the report decides which fixes become specs.
