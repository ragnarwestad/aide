Run `/setup-review` on this repository (Aide), headless, using the three progress steps below. Skill steps are
instructions within these steps, not a second progress plan. Nobody is watching, so nothing is asked: change no file in
the repository, commit nothing and push nothing.

## Step 1 of 3: Find the findings

Run Steps 1 and 2 of `/setup-review`. For kind 8 and kind 9, the previous review is the newest `index.html` in the
folders beside `$AIDE_SCHEDULE_OUTPUT_DIR` (its parent folder holds one folder per run); without one, report the totals
alone and look at scheduled runs from the last seven days.

## Step 2 of 3: Write the report

Write the list from Step 3 of `/setup-review` to `$AIDE_SCHEDULE_OUTPUT_DIR/index.html` — that directory is this run's
own directory, and the file is what the entry's page shows as the run's report. Plain HTML, no styling, in plain
everyday Norwegian (bokmål); file paths, quotes and searches stay as they are. Start with one line giving the commit read
(`git rev-parse --short HEAD`) and the totals from kind 8, then the numbered list.

## Step 3 of 3: Stop

Create no spec and propose none to the board: write no `proposed-specs.json`. The person reading the report picks the
points by number and has them fixed in a session.
