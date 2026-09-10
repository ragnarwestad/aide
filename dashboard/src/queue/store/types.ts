// What the queue store answers with, and what it is built from.
//
// Split out of store.ts 2026-09-04, where the file had reached 514
// lines. The types are unchanged and keep their names; the store
// itself stays one class, because the four methods a split would
// have moved reach into its own private state, and reaching in from
// outside is worse than a long file.

import type { JobState, TransitionEvent } from "../steps.ts";
import type { CreateProjectAllower, Job, ProjectResolver, QueueDefaults } from "../types.ts";

/** What `setPendingModel()` answers with — never a `job`, since none
 *  may exist yet for the phase a pick was just made on. `ParseResult`
 *  (`parse-request.ts`) always carries one, which is why this needs a
 *  smaller type of its own. */
export type PendingModelResult = { ok: true } | { ok: false; error: string };

/** The sibling of `PendingModelResult`, for `setPendingEffort()` (spec
 *  364) — same shape, same reason. */
export type PendingEffortResult = { ok: true } | { ok: false; error: string };

/** The sibling of `PendingModelResult`/`PendingEffortResult`, for
 *  `setPendingSteps()` (spec 439) — same shape. Unlike the other two,
 *  `setPendingSteps()` never refuses: it filters what it is given
 *  against `PHASE_STEPS` rather than reporting an unknown entry, so this
 *  is always `{ ok: true }` in practice — kept as its own type anyway,
 *  the same as its two siblings, rather than a bare `void`. */
export type PendingStepsResult = { ok: true } | { ok: false; error: string };

/** What `QueueStore.transition()` answers with (spec 354, REQ-3): the
 *  updated job on a hit, or the state and event the table refused —
 *  never a bare `undefined`, so a refusal cannot be mistaken for
 *  "nothing happened" the way `update()`'s return already can be. */
export type TransitionResult = { ok: true; job: Job } | { ok: false; state: JobState; event: TransitionEvent };

export interface QueueOptions {
  defaults: QueueDefaults;
  resolve: ProjectResolver;
  mirrorPath?: string;
  /** Where a model picked for a phase before any job exists survives to
   *  (spec 308) — the `pending-models.json` sibling of the queue mirror.
   *  Absent means the table is in-memory only, for the tests and any
   *  caller that has no disk to give it. */
  pendingModelsPath?: string;
  /** The sibling of `pendingModelsPath`, for an effort level picked
   *  before any job exists (spec 364) — the `pending-effort.json`
   *  sibling of the queue mirror. */
  pendingEffortPath?: string;
  /** Where a phase choice recorded at create time, or at a later Run,
   *  survives to (spec 439) — the `pending-steps.json` sibling of the
   *  queue mirror. Absent means the table is in-memory only, the same
   *  as `pendingModelsPath` absent. */
  pendingStepsPath?: string;
  cap?: number;
  /** Which projects may have a spec CREATED in them (spec 93). Absent
   *  means none: creating is off unless the server says otherwise, like
   *  every other capability here. */
  allowCreateProject?: CreateProjectAllower;
  /** Something in here moved (spec 189). Called after the write has
   *  landed and been mirrored, and only when one really landed — a
   *  refused enqueue or an unknown id changed nothing, and a page told
   *  otherwise would redraw for news it does not have. Absent means
   *  nobody is listening, which is what every test and every other
   *  caller of this class is. */
  onChange?: () => void;
}
