# Replaying specs

## Table of contents

- [What a replay is](#what-a-replay-is)
- [What it measures](#what-it-measures)
- [Running a round](#running-a-round)
  - [The login](#the-login)
  - [One spec per process](#one-spec-per-process)
  - [Following a round](#following-a-round)
- [The results](#the-results)
- [What a round costs](#what-a-round-costs)
- [Deciding from a round](#deciding-from-a-round)

---

## What a replay is

`scripts/replay_specs` runs archived specs again, with another model or another
version of the skills, and compares the result with what the spec produced the
first time. It is how Aide decides which model runs a step.

For each spec it is given, the script:

1. copies the project's code repository at the commit just before the spec's code
   landed;
2. makes a specs repository holding only that spec: its description as archived,
   and the analysis, plan and status fresh from the templates;
3. runs `analyze`, and `implement` when asked, through the runner of the Aide commit
   it is given, with the tool, model, effort and advisor it is given per step;
4. measures the run, writes one table, and removes the copies.

Nothing is written to the board's queue, to the real specs repository or to any
origin. A replay does not show on the board: it is a script started by hand.

The steps run with the permission mode the queue gives them (`bypassPermissions`).
The copies keep the repositories safe, but nothing keeps a session from reaching
the rest of the machine, so replay only specs and Aide commits you trust.

The script's own help (`python3 scripts/replay_specs --help`, and the docstring in
`scripts/replay_specs/__main__.py`) lists every option.

---

## What it measures

One row per spec, and a total row:

| Column                    | What it says                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Files found               | How many of the files the original landing changed the new analysis named, and how many it named that were not changed |
| Must-fix, Should-fix      | The counts from the new plan's review                                                                                  |
| Every AC placed           | Whether every acceptance criterion has a place for its test in the plan                                                |
| Green, Rounds             | Whether implement ended on a green suite, and after how many test rounds                                               |
| Original tests            | How many of the original spec's tests pass against the new code                                                        |
| Judge                     | A score from 1 (clearly worse than the original plan) to 5 (clearly better); 3 means as good                           |
| Time/tokens/cost per step | For analyze, implement and the judge                                                                                   |

Under the table, the judge's reasons for each score. With `--repeat N` each spec is
replayed N times, and the row also says how many of its replays went green and how
far implement's cost spread: one replay cannot tell a steady result from a lucky one.

---

## Running a round

A round runs on the machine that serves the board, `rw-macmini-m2`, from
`~/develop/aide`, in a tmux session so it outlives the ssh connection. A round of
eight specs with analyze and implement takes eight to ten hours.

Check the board's queue first: a round shares the account's usage limit with the
board's own jobs.

### The login

A fresh Claude config folder has no login, so the script reads one from
`CLAUDE_CODE_OAUTH_TOKEN`. The token is made once with `claude setup-token` and kept
in `~/.aide/replay-token` (mode 600). The launcher reads it from there; never print
it or put it in a script.

### One spec per process

Start the script once per spec, each in its own process group, and try a failed
spec once more. A signal or a crash then costs one spec, not the round. The
launchers in `~/.aide/` on the serving host do this; `~/.aide/run-replay-a1.sh` is
one to copy:

```bash
perl -e "setpgrp(0,0); exec @ARGV" python3 scripts/replay_specs --project aide --specs 615 \
  --aide-commit c206cae8 --analyze claude sonnet --advisor opus --implement claude sonnet --judge opus \
  --code ~/develop/aide --specs-root ~/develop/aide-specs/aide --results ~/.aide/replays/<round>/615
```

Start it with `tmux new-session -d -s <name> <launcher>`.

Keep `--aide-commit` the same across rounds that are to be compared: the runner and
the skills come from that commit.

### Following a round

- `ssh rw-macmini-m2`, then `tmux attach -t <name>` shows the launcher.
- `run.log` in the round's folder says which spec started and ended, with its exit
  code.
- `heartbeat.log` beside it gets a line a minute while the launcher lives.
- Each spec's own `replay.log` has the script's output.

---

## The results

Each spec's folder holds a run folder, `<date>-<time>-<aide commit>/`, with:

- `results.md` — the table and the judge's reasons;
- per spec, `analyze.log` and `implement.log`, the steps' result JSON, and the raw
  `.stream` of each session, with the test log beside implement's.

---

## What a round costs

Analyze and implement on Sonnet cost about $6–7 per spec, and analyze on Opus about
twice that. An advisor adds about $1–2 per analysis. The judge costs cents. On a
subscription, the cost counts toward the account's usage limit, and a long round can
reach the five-hour limit: a spec that hits it has no result and is run again.

---

## Deciding from a round

A step changes model only when a round shows the new choice is at least as good on
the specs the round replayed, compared with what those specs got on the board:

- implement green at least as often;
- the original tests no more than 5 percentage points lower;
- the judge's mean score not lower than 3;
- at least 25 % cheaper per step.

Two or three specs are too few to decide on; a round has eight or more.
