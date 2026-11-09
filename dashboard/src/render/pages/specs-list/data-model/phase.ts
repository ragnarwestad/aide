// A spec's phases: the steps a run goes through, the phase lines a row shows,
// what one phase says about itself (the Phase every row is built from), and
// the rule that names a row's Run button.
//
// The specs page script bundles this file (`specs-client/row-swap.ts`), so it
// imports nothing at run time except the step labels, which import nothing
// either: a runtime import added here reaches the browser.

import type { QueueRowView } from "../../../ui/job-state";
import { stepButton } from "../../../../format/step-label.ts";

// Exported because `queue.ts` keeps the same list under
// `PHASE_STEPS` — it decides which steps a running job may still be
// given — and the render layer does not import that module. A test
// reads both and refuses to let them drift.
export const RUN_STEPS = ["analyze", "implement", "archive"];

// The phase LINES a spec's expanded row shows, in order. `create` is
// history, not a control: a spec that exists cannot be
// created again, so it is never a checkbox (`phaseSubRows`), never a
// progress pip (`specHeadRow`), and never "the next phase"
// (`nextStep`/`readyPhase`/`allDone`) — all four of those keep reading
// `RUN_STEPS` directly. Only the phase-line list reads this one.
//
// Exported so `serve.ts` can iterate the same four steps
// while reading each one's phase-outcome file, rather than keeping a
// second, hand-copied list of them.
export const PHASE_LINES = ["create", ...RUN_STEPS];

/** The phases a spec on the specs list still has ahead of it, in workflow
 *  order. `archive` is never counted done: archived-ness is a directory, and
 *  a spec the list shows is still in the active root, whatever its history
 *  says about an archive step having run. So archive is the floor every row
 *  has ahead, and the answer is never empty. For rows on this list only: a
 *  summary of specs that really are archived needs archive counted done. */
export function phasesAhead(done: readonly string[]): string[] {
  const ran = new Set(done);
  ran.delete("archive");
  return RUN_STEPS.filter((s) => !ran.has(s));
}

/** The phase a spec on the list is waiting on: the first of `phasesAhead`. */
export const nextPhase = (done: readonly string[]): string | undefined => phasesAhead(done)[0];

/** What the Run button says and whether a press would do anything. With a
 *  phase ticked, the first ticked one in workflow order, enabled — a phase
 *  that has run included, since a press runs every ticked box. With nothing
 *  ticked, the next phase, disabled: named for what it would take to make a
 *  press do something, rather than hidden. The page draws the button by this
 *  and the page script names it again by this as the boxes are clicked. */
export function runButton(
  done: readonly string[],
  ticked: ReadonlySet<string>,
): { label: string; active: boolean } | undefined {
  const first = RUN_STEPS.find((s) => ticked.has(s));
  const shown = first ?? nextPhase(done);
  return shown ? { label: stepButton(shown), active: !!first } : undefined;
}

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
   *  why its last run did not finish, and whether
   *  `4-status.md` agrees that it ran at all. */
  history: { stopped?: string; fileDisagrees?: boolean; historyDone?: boolean; settling?: boolean };
  /** What this phase ran on, when it is a LOCKED phase's own record
   *  from `ArchivedSpecView.models`, never set for a live
   *  phase (whose "what it ran on" is `attempts[0]?.model`, read
   *  through the picker's pre-fill instead). */
  model?: string;
  /** What this phase ran at, when it is a LOCKED phase's own record
   *  the sibling of `model` above, on the same terms: from
   *  `ArchivedSpecView.phaseOutcomes`, never set for a live phase (whose
   *  "what it ran at" is `attempts[0]?.effort`, read through the
   *  picker's pre-fill instead). */
  effort?: string;
  /** What this phase's own file record says it cost, in time and money
   *  from `ArchivedSpecView.phaseOutcomes` for a LOCKED
   *  phase, on the same terms as `model` above. For a LIVE phase
   *  it is the fallback `specPhases` reads off the phase's own
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
  /** How many times this phase's own file says it has run —
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
  /** Why the spec was sent back to a full analysis, from the description
   *  the phase's file is — read regardless of the queue's attempts, like
   *  `fileAnalysis`. Only the create phase carries one. */
  fileSentBack?: string;
}
