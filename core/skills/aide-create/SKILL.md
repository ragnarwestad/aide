---
name: aide-create
description: >-
  Create the document structure for a JIRA issue or TODO plan with the 4-file
  spec structure (description, analysis, solution, status).
  Use when: creating a new task, a new JIRA issue, a new TODO plan,
  starting new work that needs documentation.
  Do NOT use for: analysis (use aide-analyze), implementation (use aide-implement),
  code review.
argument-hint: "[PROJ-XXXX or TODO <description>]"
effort: medium
---

Create the document structure for a JIRA issue or TODO plan.

**Input:** $ARGUMENTS (all arguments after the command)

## Smart detection

Parse `$ARGUMENTS`:

**JIRA mode:** If the first word is a JIRA key: `[A-Z][A-Z0-9]*-[0-9]+` (any project prefix, e.g. `PROJ-7890`, `MEL-123`). `TODO-` is never a JIRA key — TODO mode wins.
- Example: `/aide-create PROJ-7890`
- Title: JIRA key, description: fetch from JIRA if possible
- JIRA base URL: read `AIDE_JIRA_BASE_URL` from `.aide/config` in the project
  root. If the file or key is missing, ask the user once and offer to save it
  there. Never guess the URL.

**TODO mode (with name):** If the first word starts with `TODO-` (but is not just `TODO`)
- Example: `/aide-create TODO-redux-form-migration Move all forms`
- Title: `TODO-redux-form-migration`, description: the rest of the arguments

**TODO mode (auto-generated):** If the first word is just `TODO`
- Example: `/aide-create TODO Move forms to React Hook Form`
- Title: generated automatically from the description

**Error handling:** If the argument is missing or has an invalid format, show:

```text
Missing argument

Usage:
/aide-create PROJ-XXXX                    # For JIRA issue
/aide-create TODO-<name> <description>       # TODO with name
/aide-create TODO <description>              # TODO auto-generated

Examples:
/aide-create PROJ-7890
/aide-create TODO-redux-form-migration Move forms from Redux Form
/aide-create TODO Implement dark mode
```

---

## Workflow

### Step 1: Find the specs root

- Read `AIDE_SPECS_PATH` from `.aide/config` in the project root
  (helper: `aide_specs_root` in `_aide-spec-lib.sh` does the whole lookup)
- If the key is set: use that path as the specs root
- Otherwise: use `specs/` in the project root
- `git pull --ff-only` the specs root before Step 2 reads it — Step 2's
  number and Step 5's commit both work from whatever is on disk right
  now, not from whatever it was when this session last looked.

### Step 2: Find the next available number

- Find the highest number from the `NN-slug` format in the specs root
  AND in `<specs-root>/archive/` — archived specs keep their number,
  and a number must never be reused
- Next number = highest + 1 (or 01 if none exist), leading zero: `01`, `02`, ...
- Helper: `aide_next_spec_number <specs-root>` in `_aide-spec-lib.sh`
  does exactly this

### Step 3: Generate a slug from the title

- Lowercase, spaces → hyphens
- Transliterate non-ASCII letters to their ASCII equivalents
- Remove special characters and double hyphens
- Result: `NN-slug` (e.g. `65-clean-up-console-log`)

### Step 4: Create the directory and 5 files

Call the script — never the Write tool — so file creation stays on a
Bash-only path (this is what lets a Write/Edit permission rule be
scoped to the specs-repo path later, with no legitimate case left to
break):

```bash
aide-create-spec \
  --specs-root "<specs-root>" \
  --number "<NN>" \
  --slug "<slug>" \
  --title "<title>" \
  --description "$(cat <<'AIDE_DESC'
<the description text, verbatim>
AIDE_DESC
)" \
  --depends-on "<value>"   # omit this flag entirely when the prompt states none
```

**Depends on:** if the prompt states a Depends-on value (the "New spec"
form on the dashboard passes one as
`Use exactly this Depends-on value in Tracking info: <value>`), pass it
via `--depends-on`, using the value EXACTLY as stated, comma-separated.
The script writes it into `1-description.md`'s Tracking info as a
`Depends on:` line directly after `Created`, one backticked identifier
per entry:

```markdown
- **Depends on:** `105`, `92-a-spec-can-depend`
```

When the prompt states no such value, omit the `--depends-on` flag
entirely. Never infer a dependency from the description.

The script creates `<specs-root>/NN-slug/` and its 5 files, refuses
(non-zero exit, `terminalReason: "refused"`) rather than overwriting an
existing folder at that path, and prints one JSON line:
`{"ok":true,"exitCode":0,"specFolder":"NN-slug","files":[...]}`. Read
`specFolder` and `files` from that line for Steps 5 and 6 below — do
not assume the 5 filenames.

Markdown validation uses `markdownlint-cli2` only when it is installed locally.
Rely on the automatic hook where present; otherwise check for the executable
with `command -v markdownlint-cli2` before running it. If it is unavailable,
report that validation was skipped and continue. Validation must not invoke `npx`
or another package-download fallback. This validation stays a Bash invocation
in the skill, not moved into the script — it already carries none of the
permission-layer ambiguity this change removes, and folding it in would add an
external-tool dependency to a script whose only other dependencies are `bash`
and `jq`, for no reduction in that ambiguity.

### Step 5: Stage in git

`git add <specs-root>/<specFolder>/*.md`, using the `specFolder` the
script's JSON reported — the specs root is a working directory the
skill can operate in, whether or not it sits inside the project root.

A headless run gets its commit for free. Working interactively, commit
and push RIGHT AWAY, with this message so the step is recognised the
same way:

```text
Run /aide-create for <spec-folder> (model: <tool> <model>)
```

Do not ask first: the user's request to create the spec was the
approval, and a follow-up question here is how a finished folder sits
staged-but-uncommitted for hours while everyone believes it was queued.
Commit only once the 5 files have actually been
created — nothing to stage means nothing to commit. If origin has moved,
`git pull --rebase` and push again; a push that still fails is reported
out loud, never left silent.

`aide-run-spec` writes `Workflow steps completed:` from the spec's own
commits — leave that line exactly as you found it in the template. The
same script writes this phase's `Model`/`Result`/`Time spent`/`Cost`
block into `1-description.md`'s own Tracking info — leave those lines
alone too. `create` is the one stage nobody picks a model for in advance: a spec
is already being written by the time it reaches a dashboard row, so its
model is only ever recorded after the fact, from whatever commit
created the folder.

Add the `(model: ...)` part only when you can name your own model with
certainty. A Claude Code session is told which model it is running in
its own context, so it can write `claude claude-opus-5`; an assistant
that cannot name itself offers the bare subject without the suffix and
never guesses. A person writing `1-description.md` by hand and
committing it under their own message leaves no such commit at all, and
no `Model (create)` line is written — an absence, never a guess.

### Step 6: Confirm

Show a summary and the next step, built from Step 4's `specFolder` and
`files` — not assumed:

```text
Task created: 55-clean-up-console-log

Files created:
- specs/55-clean-up-console-log/0-README.md
- specs/55-clean-up-console-log/1-description.md (filled in)
- specs/55-clean-up-console-log/2-analysis.md (ready for analysis)
- specs/55-clean-up-console-log/3-solution.md (ready for solution)
- specs/55-clean-up-console-log/4-status.md (ready for status)

Next step: /aide-analyze 55
```

IMPORTANT:
- Follow the workflows rules - Phase 1: Create document structure
- Follow the spec structure for the file layout
- Code blocks ALWAYS end with just ` ``` ` — NEVER ` ```text ` as the closing fence

---

## Next step

```text
/aide-analyze PROJ-XXXX   # For JIRA issue
/aide-analyze 55              # For TODO (use the task number)
```
