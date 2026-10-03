# A spec's lifecycle

## Table of contents

- [The four phases](#the-four-phases)
- [Writing a spec](#writing-a-spec)
- [One spec, from first to last](#one-spec-from-first-to-last)
- [When a spec stops, and what moves it on](#when-a-spec-stops-and-what-moves-it-on)
- [Another round on the same spec](#another-round-on-the-same-spec)
- [Going backwards: reopen](#going-backwards-reopen)
- [Closing: a different terminal move from archive](#closing-a-different-terminal-move-from-archive)

---

A spec moves through four phases: `create`, `analyze`, `implement` and `archive`. This page is for using the
board: how to write a spec, what happens to it from first to last, what stops it and what moves it on, and how to
take it back or close it. How each move is decided and recorded is in
[How a spec moves between phases](spec-transitions.md), and a single run's own states are in
[A job's states](job-states.md).

## The four phases

| Phase       | Writes                                                                                                                   | Lands                                                                                |
|-------------|--------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| `create`    | The spec folder: `0-README.md`, `1-description.md` and empty `2-`, `3-`, `4-` files, via `core/scripts/aide-create-spec` | Merged into the specs repo's default branch at once; the branch is deleted on origin |
| `analyze`   | `2-analysis.md`, `3-solution.md`, `4-status.md`, in the specs repo only                                                  | Merged into the specs repo's default branch at once; the branch is deleted on origin |
| `implement` | Code and tests in the project, the status rows in `4-status.md`, and `test-run.json` beside the spec                     | Nothing. The code waits on `aide/<folder>`                                           |
| `archive`   | The `Archived:` stamp, moves the folder into `archive/`, feeds documentation back                                        | Merges the specs repo, then the code root, runs `AIDE_INSTALL_CMD`, then asks origin |

Other steps exist — `explore`, `manifest`, `schedule`, `reopen`, `close` — but they are not phases: none of
them appears in the workflow arc. `close` and `reopen` do move a spec between STATES, which is why they have rows
in the transition table; they draw no line on a spec's row, which always has the four, and the Logs tab lists them.
They simply do not move a spec along the arc.

## Writing a spec

A spec starts on the New spec page, which has two tabs. Create sits above them and can be pressed from either; if a
required field on the Spec tab is empty, the page switches to that tab and shows the field's error there.

**The Spec tab** holds what every spec needs: the project, a title, the description, and Depends on, the specs this
one builds on. A spec that depends on another waits for it to land before its analyze starts. The description holds
up to 5000 characters.

**The description** says what is wrong and what should be true afterwards. Three parts of it are read by the runs
that follow:

- **Acceptance criteria**, one per line, `- **AC-n:**` followed by a single sentence in one of the five EARS patterns.
  The condition comes first, so a reader knows when the criterion holds before reading what it asks for:

  | Pattern            | Form                                                 | Example                                                                          |
  |--------------------|------------------------------------------------------|----------------------------------------------------------------------------------|
  | Always             | `The <system> SHALL <response>`                      | The status file SHALL carry one row per AC-n id.                                 |
  | Event              | `WHEN <trigger>, the <system> SHALL <response>`      | WHEN a step ends, the runner SHALL write its result into the status file.        |
  | State              | `WHILE <state>, the <system> SHALL <response>`       | WHILE a job runs on a spec, the specs list SHALL lock that spec's Run button.    |
  | Unwanted behaviour | `IF <condition>, THEN the <system> SHALL <response>` | IF origin refuses the push, THEN the runner SHALL keep the commit on the branch. |
  | Optional feature   | `WHERE <feature>, the <system> SHALL <response>`     | WHERE a project has a wiki, analyze SHALL read it before the code.               |

  Each criterion becomes a row to tick before archive, unless the spec was created without acceptance ticking.
- **Out of scope**, an optional section under exactly the heading `## Out of scope`: a list of what the change must
  not do or touch. Create keeps it word for word and never writes one itself. Analyze's plan review treats any part of
  the plan under an item as a must-fix, and the review after implement treats any change under an item as a defect,
  whatever the acceptance criteria checks level.
- **Depends on**, set on the Spec tab rather than written into the text.

**The Options tab** holds how the spec is run, and most specs leave it as it opens:

| Option                               | When the form opens | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                               |
|--------------------------------------|---------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Acceptance ticking required          | Ticked              | Archive waits until every acceptance criterion is ticked on the spec. Cleared, the criteria stay written down and nothing is left to tick.                                                                                                                                                                                                                                                                                                                 |
| Let AI formulate acceptance criteria | Ticked              | Create runs a short AI session that adds a criterion, in EARS, for each requirement in the description that has none. The criteria you wrote are kept word for word, with their numbers, and the added ones are numbered on from yours. Cleared, the description is saved exactly as typed.                                                                                                                                                                |
| Acceptance criteria checks           | Off                 | How strictly analyze checks the criteria: that the description has some, that each follows an EARS pattern, that each WHEN, WHILE or WHERE criterion has a scenario for when its condition does not hold, that no two contradict each other, and that each can be built. Off makes no checks; Warn lists what it finds and analyze completes; Stop holds analyze until the criteria are put right. Chosen here, and not changed after the spec is created. |
| Let me choose the approach           | Cleared             | Analyze marks each approach it weighed as recommended, a real alternative or rejected. When it finds two or more real alternatives, implement waits, and the spec's row lists them with the recommended one picked: save it to go on, or pick another to have analyze plan that one instead. Cleared, analyze picks and implement builds it.                                                                                                               |
| The phases                           | All four ticked     | Which phases run one after the other once the spec is created, and the AI and model each one runs on. Create always runs.                                                                                                                                                                                                                                                                                                                                  |

## One spec, from first to last

A spec for a change to the dashboard, run on the board, with nothing going wrong:

1. **New spec.** You fill in the Spec tab: the project, a title and a description, and leave the Options tab as it
   opens, with the four phases ticked. The job is queued under a provisional name, and the list shows a create
   running.
2. **Create lands.** The folder gets its number and slug when its branch is merged — `512-a-project-keeps-nothing`
   — and the spec has a row from that moment. Its state is `created`.
3. **Analyze runs**, writes `2-analysis.md` and `3-solution.md` with the acceptance criteria, and lands them in the
   specs repository. The state is `analyzed`, and the row's button now reads Implement.
4. **Implement runs**, writes the code and its tests on `aide/512-…`, and the runner holds it to the project's own
   suite: green ends the step, red goes back to the same session twice before the step fails. Nothing is merged —
   the code waits on the branch. The state is `implemented`.
5. **Archive is held back.** The spec has acceptance criteria, so the job ends `done` without running anything, and
   the row says so. You read the result, tick the rows on the Status tab, and press Archive.
6. **Archive runs and lands.** The folder moves into `archive/`, the documentation feedback is written, and the
   landing merges the code into the default branch once the project's tests pass on the merged result. The state is
   `archived`, and the row leaves the active list.

Anything that goes differently is one of the rows in [When a spec stops, and what moves it on](#when-a-spec-stops-and-what-moves-it-on).

## When a spec stops, and what moves it on

Every stop writes its own sentence onto the spec's row, and most of them end by naming the button to press. This
is the whole set:

| What the row says                     | What happened                                                                      | What moves it on                                                    |
|---------------------------------------|------------------------------------------------------------------------------------|---------------------------------------------------------------------|
| held back: not analyzed yet           | The spec has not analyzed, and implement needs a plan                              | Run Analyze                                                         |
| held back: choose the approach        | Analyze found two or more real alternatives on a spec that asked to choose         | Pick one on the row and press Save                                  |
| held back: depends on `<spec>`        | A spec it names has not archived yet                                               | Nothing. It starts itself once that spec archives                   |
| held back: another archive is running | A second archive in the same project is ahead of it                                | Nothing. It starts when that one has merged                         |
| archive held back                     | A row under `## Acceptance criteria` is still open                                 | Tick the rows on the Status tab, then press Archive                 |
| stopped: no-progress                  | The step said it succeeded but changed nothing in the project                      | Press the same button again                                         |
| stopped: merge-unfinished             | The step dropped the merge with the default branch it was handed open              | Press the same button again                                         |
| stopped: scope-violation              | The step wrote outside its own spec folder, or claimed a step it did not run       | Press the same button again                                         |
| stopped: tests-red                    | The project's suite is red, after the runner gave the session two more turns at it | Make the suite green, then press Implement                          |
| stopped: timeout                      | The step reached its own time limit                                                | Press the same button again; the work it committed is on the branch |
| not landed                            | Archive finished, but the spec's branch is still on origin, not merged             | Run Archive again                                                   |
| branch still on origin                | The branch merged, but deleting it on origin failed                                | Press Delete branch                                                 |
| conflict                              | A merge conflict no machine could settle                                           | Resolve it yourself, with the diff in front of you                  |

An archived or closed spec refuses every step but Reopen, whatever is ticked on its row.

## Another round on the same spec

A spec whose acceptance criteria are not all ticked, or that was reopened with its files kept, can take another round of analysis or implementation without being
reopened. It is the one way back that keeps the files: the analysis, the plan and the status stay as they are. A round
that starts with Analyze clears the ticks ([What "has had a phase" means](spec-transitions.md#what-has-had-a-phase-means));
a round that starts with Implement keeps them.

- **The round begins where archive declines.** `aide-archive-spec` refuses an archive while any row under
  `## Acceptance criteria` in `4-status.md` is open, and at that moment writes
  `- **Round boundary:** <date> (history before <sha> does not count)` into `4-status.md`. A second decline with
  nothing changed in between writes nothing; a later real round appends its own, and the last one is the one read.
- **The user edits the criteria.** The open `AC-n` rows in `1-description.md` are rewritten to say more precisely what
  was missing, or new ones are added.
- **Analyze or Implement then runs again on the same active spec.** Whether the criteria have changed enough is the
  reader's call; the server does not check it. A round that starts with Analyze ends with Implement next, since the
  analysis cancels the implement before it.
- **The round plans what is open, new or reworded.** Analyze appends a `## Round N` section to `2-analysis.md` and
  `3-solution.md` for every open id, every new id and every id whose text in `1-description.md` changed since the round
  boundary, ticked or not. The session appends a row to `4-status.md` for each new id and changes no other row; the
  runner then rebuilds the table from the description, every row open. A ticked criterion whose text is unchanged is not
  planned again: the earlier round's code and tests for it stay on the branch, and the user checks it against the new
  code when they tick it again. Implement may rewrite an open row's Notes cell with what is still missing. No skill
  ticks a row.
- **On the specs list**, a spec held back this way offers Analyze and Implement unticked beside a ticked Archive: a
  plain press archives, and another round is a choice made by ticking it.

When the user is satisfied, they tick the rows on the spec's Status tab and press Archive.

## Going backwards: reopen

Reopen keeps the spec, and discards a work round when it is asked to. It is a skill (`/aide-reopen`) at a keyboard and a
queue step the dashboard presses, never a step the runner decides on its own.

- **Reopen** takes an archived or closed spec back to the active list and asks one question in a dialog, opened
  from the Reopen button on the spec page and on the list row: also reset the analysis, the plan and the status? The
  box is unticked, and the job carries `resetFiles` only when it is ticked. Pressing OK makes the dialog stand as
  "Reopening…", listing the job's steps as its log marks them, until the job has settled.
  It deletes the branch the earlier round left behind in both modes.
  - **Keep (the default, also a bare `steps=reopen`).** `core/scripts/aide-reopen-spec` moves the folder out of
    `archive/` and runs no model. `0-README.md` to `3-solution.md` are untouched; in `4-status.md` `archive` leaves the
    `Workflow steps completed:` line and a `**Round boundary:**` stamp is appended. The spec ends in the state its files
    show (`implemented` for a spec that was implemented), not in `created`, and it takes the round described above: it
    is read as reopened while its last `**Archived:**` or `**Closed:**` stamp is followed by a `**Round boundary:**`
    stamp with no `**Reopened:**` or `**Reset:**` mark between (`reopenedRound`, `held-back.ts`). Analyze and Implement
    are accepted once one criterion is new, or reworded with its row unticked, since that boundary; the specs list
    offers them unticked beside a ticked Archive.
  - **Reset (`resetFiles`, runner flag `--reset-files`).** No model here either: `aide-reopen-spec` moves the folder
    back and `aide-reset-spec` then writes `2-analysis.md`, `3-solution.md` and `4-status.md` from the templates,
    keeping `0-README.md` and `1-description.md`. The step records
    `- **Reopened:** <date> (history before <sha> does not count)` in `4-status.md`. The sha is the boundary
    `completed_steps_for` counts from: runner commits before it are the old round's and no longer put a step on the
    line. It drops the spec's recorded phase choice too: those ticks belonged to the round just discarded.

  A stamp only counts while nothing later cancels it: an `**Archived:**` or `**Closed:**` line followed by a
  `**Round boundary:**`, `**Reopened:**` or `**Reset:**` mark is history, and the spec reads as active again. A new
  stamp after that boundary counts. [The runner and its checkouts](the-runner.md#what-counts-as-a-step-having-run)
  has which readers apply that rule.
There is no `reset` step for an ACTIVE spec: another round covers that, and a reopen with its reset covers the
rest. A `**Reset:**` stamp is still read where an older job left one, so such a spec keeps its boundary.

A spec reopened with reset reads as `created` again: the line is empty until a step runs. It also drops the phase
choice recorded under the spec (`pending-steps.json`): the ticks belonged to the round just discarded, so the row falls
back to every phase the spec has not had and its button reads Analyze. A reopen that keeps the files keeps the choice
as it was.

## Closing: a different terminal move from archive

`close` reaches the state `closed` from `created`, `analyzed` or `implemented` — every state Archive would refuse,
since Close carries no `not-implemented-yet`/`acceptance-criteria-unticked` gate. `core/scripts/aide-close-spec`
writes a
`**Closed:** <date> — <reason>` stamp (the reason is required) and moves the folder into `archive/`, exactly as
`aide-archive-spec` does — but its landing deletes the code root's branch instead of merging it, since Close records
that the work will not be used, not that it was. **Whatever code that branch held is gone with it**, and a later
reopen does not bring it back — the spec's four files return, the code does not. A closed spec reads `closed`, never `archived`, everywhere a spec's
state is shown, and only `reopen` is legal on it afterward — the same one-step exception `archived` already has.
