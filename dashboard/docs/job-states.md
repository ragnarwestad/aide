# A job's states

The one place the queue's state machine is written down: what a job's `state` can be, which piece of code moves it
and when, and the three fields beside it that behave like a state without being one. The code is `JOB_STATES` and
`TRANSITIONS` in `src/queue/steps.ts`, consulted through the one `QueueStore.transition()` in `src/queue/store.ts`
that every caller — `src/queue/runner.ts`, the cancel route in `src/serve/handle-queue/job-actions.ts`, and the
landing in `src/serve/land-branch/merge.ts` — asks instead of writing `state` itself. How a
state reads on the page is on [The specs list and the spec page](the-specs-list.md); the level above — which of the four
phases a SPEC has reached, and what moves it — is on [A spec's lifecycle](spec-lifecycle.md).

## Table of contents

- [The seven states](#the-seven-states)
- [The transitions](#the-transitions)
- [Beside the state](#beside-the-state)
- [What the page makes of it](#what-the-page-makes-of-it)

---

## The seven states

A job is an ordered list of steps with a `stepIndex`; its `state` says where the job as a whole is.

| State         | Meaning                                                                                        |
|---------------|------------------------------------------------------------------------------------------------|
| `queued`      | Waiting for the runner to start its next step. Also where a job sits between two steps.        |
| `running`     | One step has a live process. `pid`, `pgid`, `resultFile`, `sessionId` and `streamFile` are set. |
| `done`        | Every step succeeded and, for a step that lands, the landing succeeded too.                     |
| `stopped`     | A cap ended the run before or during a step. `stopReason` says which cap.                       |
| `failed`      | A step reported failure, or a landing after a successful step did not finish.                  |
| `cancelled`   | A person pressed Cancel.                                                                       |
| `interrupted` | The step's process died without leaving a result.                                              |

Only `queued` and `running` own their work (`UNFINISHED` in `src/queue/steps.ts`). Every other state has released
it: the same step may be queued again for the same spec, and the duplicate guard no longer refuses it.

## The transitions

```mermaid
stateDiagram-v2
    [*] --> queued: POST /api/queue, /create, schedule
    queued --> running: tick — a slot is free
    queued --> stopped: tick — the job cap would be exceeded
    queued --> done: tick — no step left
    running --> queued: step ok, more steps
    running --> done: step ok, last step
    running --> stopped: budget, timeout, provider limit
    running --> failed: step failed
    running --> interrupted: process gone, no result
    done --> failed: landing did not finish
    queued --> cancelled: Cancel
    running --> cancelled: Cancel
```

**Into the queue.** `POST /api/queue`, `POST /api/queue/create` and the schedule poll all insert a job as `queued`.

**The runner's tick, every two seconds** (`Runner.tick()`), walks the queue in `queuePriorityOrder()`'s order — every
queued `create` or `archive` step before any queued `analyze` or `implement`, oldest first within each group
(`src/queue/steps.ts`) — and, for each `queued` job:

- Starts nothing at all while any job has `landing` set — see [Beside the state](#beside-the-state).
- Skips a job whose spec already has a running job: two steps for one spec are ordered by nature.
- Leaves a job `queued` with a reason on it — "held back: not analyzed yet — run /aide-analyze first" — when its own
  spec's `analyze` step has not completed, and tries again next tick. The state does not move.
- Leaves a job `queued` with a reason on it — "held back: depends on …" — when a dependency it names has not
  archived, and tries again next tick. The state does not move.
- Leaves a job `queued` the same way when the daily cap would be exceeded, counting the budgets of the steps already
  in flight. A cheaper job behind it may take the slot.
- Moves a job to `stopped` (`stopReason: "job-cap"`) when its NEXT step's budget would exceed the job cap. The cap is
  checked before the step starts, so the step never runs.
- Moves a job with no step left to `done`.
- Otherwise spawns the step and writes `running`, with the process and file fields.

**When a step ends** (`Runner.complete()`, reached from `poll()` when the result file appears):

- `budget`, `timeout` or `provider-limit` as the run's terminal reason gives `stopped`, with that `stopReason`.
- Any other failure gives `failed`, with `error` and, when the runner found a merge conflict at step start,
  `errorReason: "conflict"`.
- Success on the last step gives `done`. Success with steps left gives `queued` again, with `stepIndex` advanced.
  There is no stop between steps: every step lands its own work.

**Interrupted** is written in two places, both for a `running` job whose process is gone and whose result file is
empty: `poll()` while the server runs ("the run vanished without leaving a result"), and `reconcile()` on boot ("the
server restarted while this step was running"). A job whose process is gone but whose result IS on disk is completed
normally from that file — nothing about a restart is guessed at.

**Cancelled** comes from `POST /api/queue/<id>/cancel` alone. It sends `SIGTERM` to the job's process group when there
is one and writes `cancelled`. A job that has already finished is refused with 409 and keeps its state: `done`,
`failed`, `stopped` and the rest are history, and Cancel does not rewrite history.

**Done to failed** is the one transition made after the fact. The step succeeded, so `complete()` has already written
`done`, and the landing runs afterwards. When that landing is refused for a conflict, or `archive`'s landing finds the
spec's branch still on origin, the `landing-failed` transition moves the job to `failed` with `errorReason` — and only
from `done`: the runner may have queued the job's next step in between, and a landing must not overwrite a job that
has moved on; the table simply has no entry for that case, so the attempt is refused and the narrative fields are
recorded without moving the state. See [Branches and landing](landing.md).

## Beside the state

Three fields say something the state alone does not, and each is read by the page as if it were one.

- **`landing`** is set on a job while its finished step's branch is being merged, and cleared once the whole landing
  promise settles. While ANY job carries it the runner starts nothing, because a landing writes to the shared main
  checkout that no worktree isolates. It is never restored from the persisted mirror: a flag that survived a restart
  would hold the queue shut with nothing left to clear it. **An `onLanded` callback runs before its own job's flag is
  cleared.** `Runner.complete()` in `src/queue/runner.ts` is synchronous: it starts the landing work (`onStepDone`,
  e.g. `landArchivedSpec` for `archive`), writes `landing: true` onto the job's own store row, and only clears that
  flag in a `.then()` once the WHOLE landing promise settles — including whatever `onLanded` itself does. So a callback
  that reads `queue.list()` sees its own triggering job still marked `landing: true` even though the landing calling
  it has already succeeded, and must treat that one row as settled by hand; every other row's flag is as trustworthy
  as ever.
- **`stopReason`** is `budget`, `timeout`, `provider-limit` or `job-cap`, set with `stopped` and nowhere else.
  `stopped` is deliberately not `failed`: under tight caps a cap-stop is a common, healthy outcome.
- **`errorReason`** is `conflict` or `unlanded`, set with `failed` when a person can act on the cause — re-running
  `archive` resolves both. It is declared in `src/queue/types.ts` and again in `src/render/ui/job-state/types.ts`,
  which do not import each other; `test/queue/parsing-schedule-and-errors.test.ts` reads both as text and asserts they agree. `error` beside it is
  the sentence for a reader, present on `stopped`, `failed` and `interrupted`, and on a `queued` job that is held back.

## What the page makes of it

The row's first line is the verb for what is happening or the resting state and what is next — never the bare word.
`running` reads as the phase's own verb ("analyzing"); `queued` as "<phase> n/total" — its place among every job waiting
its turn, off the same order the runner picks — or, held back, the reason; `done`
as "ready for <next phase>" or "done — nothing waiting on you"; `stopped` as "stopped — budget", "stopped — 45 min",
"stopped — provider limit" or "stopped — job cap"; `failed` with `errorReason` as the conflict or the unlanded branch
and the button that re-runs `archive`. `cancelled` is drawn as a deliberate ending, not a failure; `interrupted` is
grouped with `failed`. The words themselves live in `src/render/ui/job-state/` and are described on
[The specs list and the spec page](the-specs-list.md#how-the-list-reads).
