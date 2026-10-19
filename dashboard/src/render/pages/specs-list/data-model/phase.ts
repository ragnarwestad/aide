// A spec's phases: the steps a run goes through, the phase lines a row shows,
// and what one phase says about itself (the Phase every row is built from).

import type { QueueRowView } from "../../../ui/job-state";

// Exported since spec 160: `queue.ts` keeps the same list under
// `PHASE_STEPS` — it decides which steps a running job may still be
// given — and the render layer does not import that module. A test
// reads both and refuses to let them drift.
export const RUN_STEPS = ["analyze", "implement", "archive"];

// The phase LINES a spec's expanded row shows, in order. `create` is
// history, not a control (spec 116): a spec that exists cannot be
// created again, so it is never a checkbox (`phaseSubRows`), never a
// progress pip (`specHeadRow`), and never "the next phase"
// (`nextStep`/`readyPhase`/`allDone`) — all four of those keep reading
// `RUN_STEPS` directly. Only the phase-line list reads this one.
//
// Exported (spec 247) so `serve.ts` can iterate the same four steps
// while reading each one's phase-outcome file, rather than keeping a
// second, hand-copied list of them.
export const PHASE_LINES = ["create", ...RUN_STEPS];

export interface Phase {
  step: string;
  /** Every job whose current/last step is this phase, newest first. A
   *  phase can be re-run — `85-dashboard-into-aide` archived three
   *  times — so this is a list, not a job. */
  attempts: QueueRowView[];
  /** Archive only: the spec's own reason for not having been archived.
   *  Every other phase answers "has this happened" out of `done`. */
  heldBack?: { reason: string };
  /** What this phase's own git history says beyond whether it happened
   *  (spec 154): why its last run did not finish, and whether
   *  `4-status.md` agrees that it ran at all. */
  history: { stopped?: string; fileDisagrees?: boolean; historyDone?: boolean; settling?: boolean };
  /** What this phase ran on, when it is a LOCKED phase's own record
   *  (spec 244) — from `ArchivedSpecView.models`, never set for a live
   *  phase (whose "what it ran on" is `attempts[0]?.model`, read
   *  through the picker's pre-fill instead). */
  model?: string;
  /** What this phase ran at, when it is a LOCKED phase's own record
   *  (spec 364) — the sibling of `model` above, on the same terms: from
   *  `ArchivedSpecView.phaseOutcomes`, never set for a live phase (whose
   *  "what it ran at" is `attempts[0]?.effort`, read through the
   *  picker's pre-fill instead). */
  effort?: string;
  /** What this phase's own file record says it cost, in time and money
   *  (spec 247): from `ArchivedSpecView.phaseOutcomes` for a LOCKED
   *  phase, on the same terms as `model` above. For a LIVE phase (spec
   *  284) it is the fallback `specPhases` reads off the phase's own
   *  stamped file when `attempts` is empty — a queue-job attempt always
   *  wins when one exists, so this is set on a live phase only where
   *  `attempts[0]` has nothing to say. */
  timeSpentMs?: number;
  cost?: number;
  costUnmeasured?: boolean;
  tokens?: number;
  /** The model id this phase's own file says its run reported — read only
   *  where the queue has no attempt for the phase, like `cost` above. */
  modelId?: string;
  /** How many times this phase's own file says it has run (spec 341) —
   *  read regardless of how many queue-job attempts exist, unlike
   *  `timeSpentMs`/`cost`/`tokens` above: those speak for the LATEST
   *  attempt only, so the file is a fallback for when the queue has
   *  none; this is a running total, so the file has to be checked even
   *  when the queue has some, in case it remembers fewer than really
   *  happened. `phase-rows.ts` takes the larger of this and
   *  `attempts.length`. */
  attemptCount?: number;
  /** What the phase's own file says the last run came to — "completed"
   *  or "stopped" (spec-structure's `Result:` bullet). Read ONLY where
   *  the queue has no job for this phase and the git-verified history
   *  names none either: it is the run's own claim about itself, not
   *  proof the work landed, so it never outranks either of those. */
  fileResult?: "completed" | "stopped";
  /** Which analysis the phase's own file says the latest one was — read
   *  regardless of the queue's attempts, like `attemptCount`: the bullet
   *  names the analysis that file holds, whoever ran it. Only the analyze
   *  phase carries one. */
  fileAnalysis?: "short" | "full";
}
