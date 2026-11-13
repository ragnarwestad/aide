// The row-level facts everything else on a spec's rows is built from:
// whether it is busy, what phase it is waiting on, what a press would
// run.

import { inFlight, type QueueRowView } from "../../ui/job-state";
import { groupKey, isArchivedRow, offersArchiveAgain, type SpecGroup } from "./data-model";
import { nextPhase, phasesAhead, runButton } from "./data-model/phase.ts";
import type { Language } from "../../../i18n";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../project/parse-status";
import { ACCEPTANCE_CRITERIA_UNTICKED } from "../../../step-endings.ts";

/** Whether a job is in flight on this spec — queued, running, or parked
 *  at a gate. ONE rule for the whole row, read off the SPEC and not off
 *  the steps some job happens to name: the queue refuses a second job
 *  on a spec that already has one (`clashing()`, queue.ts), so every
 *  control the row draws beside Cancel would be promising a press the
 *  server was going to turn down. `actionForm` already narrows itself
 *  to Cancel (or Approve + Cancel); everything else on the row reads
 *  THIS, so a control added later has one question to ask rather than a
 *  rule to remember. */
export const specBusy = (g: SpecGroup): boolean => !!g.lead && inFlight(g.lead);

export function groupActionState(members: SpecGroup[]): "start" | "archive" | undefined {
  if (members.every(isArchivedRow)) return undefined;
  return members.length > 0 && members.every((child) =>
    child.done.includes("implement") && !child.acceptanceOpen && !specBusy(child)) ? "archive" : "start";
}

/** An archived row whose code never landed, with its archive running
 *  again: it reads and acts as a live row does until the run is over. */
export const archivingAgain = (g: SpecGroup): boolean => offersArchiveAgain(g) && specBusy(g);

// The phase a spec is waiting on, read by the badge and the button in the
// State column alike, so the two cannot name different phases.
export { nextPhase };

// What a press would run, if the reader had never touched a box: EVERY
// phase the spec has not had. A press takes the spec as far
// as it can go, and unticking a box is how a reader says to stop
// somewhere. It depends on how far the spec has got, and on nothing
// about which phase is asking.
//
// `done` is what the spec's own git history PROVES: the
// runner commits every step it finishes, and only such a commit puts a
// step here — a `4-status.md` line naming a step is a claim the row
// reports a disagreement about, never a source. A step run at
// somebody's keyboard counts once it is committed with the same
// subject, which is what the skills now offer to do; declined, the
// spec reads as still having that phase ahead of it.
//
// It is `phasesAhead(g.done)`, the walk `nextPhase` takes the first of,
// so the default ticks and the button's next phase come from one rule.
// Archive is always among them, so the row always has a button.
//
// Renamed from `preTicked()`: this is no longer the only
// answer to "what is ticked" — it is `chosenSteps()`'s own fallback now,
// for a spec that has never had a create or a Run recorded under that
// fix. The boxes are on the phase lines and each asks this the same
// question, so the rule is read once per row and consulted per phase.
function defaultTicked(g: SpecGroup): Set<string> {
  return new Set(phasesAhead(g.done));
}

// What the row's boxes are ticked FROM: a phase choice
// recorded at create time, or at the reader's own later Run —
// `opts.pendingSteps`, keyed `project/specFolder` the same way
// `pendingModels` already is — when one is on record,
// and `defaultTicked()` above only as the fallback for a spec that has
// never had either kind of submission recorded under this fix.
//
// Git history alone gives a reader's own choice no way to survive past
// the job that made it: the create-time ticks a fresh spec was given, or
// the ticks left on a row after a later Run, would be gone the moment
// the page next redrew. This is what closes that gap.
export function chosenSteps(g: SpecGroup, opts: { pendingSteps?: Record<string, string[]> }): Set<string> {
  const recorded = opts.pendingSteps?.[groupKey(g.project, g.specFolder)];
  const chosen = recorded ? new Set(recorded) : defaultTicked(g);
  // A phase that has run is run again only when the reader ticks it:
  // its box is no longer locked, and a choice remembered from before it
  // ran would otherwise run it a second time on the next press.
  if (recorded) for (const step of g.done) if (step !== "archive") chosen.delete(step);
  // Held back on its checks: archive is what comes next, and the round
  // offered beside it is a choice the reader makes by ticking. The
  // remembered choice names the chain that has just run, and ticked
  // again it turned a press meant for archive into another round.
  if (roundOffered(g)) {
    chosen.delete("analyze");
    chosen.delete("implement");
    chosen.add("archive");
  }
  return chosen;
}

// What the row's one button SAYS, and whether a press on it would do
// anything. Two things follow from
// naming it after the CHOSEN phases rather than after the state's own
// suggestion:
//
// A reader can see the two disagree before pressing. The State column
// says what the spec's files make of it — "ready for analyze" — and the
// button says what a press would actually run. Where those differ the
// row reads "ready for analyze · Implement", and the disagreement is in
// the line rather than in the result.
//
// And a press on a SHUT row is legible: its phase boxes are not drawn,
// so the button's own word is the only thing that says what it would
// do.
//
// A label or `undefined` alone would leave no room for a third state —
// "named, but not ticked". Because `defaultTicked()`'s own archive-floor
// rule never comes back empty, "nothing ticked" would be unreachable for
// an ordinary row and the button would read "Archive", always active,
// the moment analyze and implement were both done — whatever the reader
// had actually ticked. `active` is what lets the button stay named without
// claiming a press would do something it would not.
export function actionState(
  g: SpecGroup,
  opts: { pendingSteps?: Record<string, string[]>; lang?: Language },
): { label: string; active: boolean } | undefined {
  // The rule the page script names the button by too, so a redraw never
  // changes what it says. The ticks this side draws never hold a phase
  // that has run: `defaultTicked` leaves them out, `chosenSteps` drops
  // them from a recorded choice.
  return runButton(g.done, chosenSteps(g, opts), opts.lang);
}

// The run form's own id. It exists for the rarely-set fields' sake
// alone: they are written after the form's closing tag, on the same
// line, and `form="<id>"` is what makes the browser post them with it
// anyway.
export const runFormId = (g: SpecGroup): string => `rowrun-${groupKey(g.project, g.specFolder)}`;

// The row's own anchor. `id`, not `data-folder`: a badge pointing at
// another spec's row needs something `href="#..."` can find with no
// script at all — this page's own rule. Same shape as `runFormId`, so
// "an id that names a spec" stays the one convention it already is.
export const rowAnchorId = (g: SpecGroup): string => `spec-${groupKey(g.project, g.specFolder)}`;

export { specNumber } from "../../../project/spec-folder.ts";

// --- Another round on a spec held back on its checks -------------
/** The archive step's own refusal, as the RUNNER leaves it: the
 *  mechanical precheck turns the step away before any model is spawned,
 *  and the job it belongs to finishes `done` with no error of its own.
 *  So the only trace on the row is the step result's reason — which is
 *  why this is read as well as the note below, and not instead of it. */
const refusedForChecks = (a: QueueRowView): boolean =>
  (a.results ?? []).some((r) => r.step === "archive" && r.terminalReason === ACCEPTANCE_CRITERIA_UNTICKED);

/** Is this spec waiting on a person to judge its acceptance criteria?
 *  Two records say so and either may be the only one there: the note
 *  `4-status.md` carries once an archive RUN wrote it, and the step
 *  result a run refused before that. Both are about the LAST run; the
 *  Checks tab answers for now, and a spec whose every criterion has
 *  been ticked since is waiting on nobody. */
export function heldBackOnChecks(g: SpecGroup): boolean {
  if (g.acceptanceOpen === false) return false;
  const archive = g.phases.find((p) => p.step === "archive");
  if (!archive) return false;
  return archive.heldBack?.reason === ACCEPTANCE_CRITERIA_UNTICKED_NOTE ||
    archive.attempts.some(refusedForChecks);
}

/** The question `chosenSteps` asks: is
 *  another round offered on this row — held back on its checks, or
 *  reopened with the files kept and at implemented, where
 *  nothing is open by construction. */
export function roundOffered(g: SpecGroup): boolean {
  return heldBackOnChecks(g) || (g.reopenedRound === true && g.done.includes("implement"));
}

/** Is a round of work under way on this spec right now — a job in
 *  flight with `analyze` or `implement` still ahead of it or running?
 *  The marks a held-back archive carries are worked out afresh on every
 *  render, from open criteria and a finished implement, so they stay
 *  true all through the round that exists to clear them. The archive's
 *  own run is already excepted where they are drawn; this is the same
 *  case one phase earlier. Read off the REMAINING steps, never the
 *  whole list: a bundled job waiting to run `archive` has `analyze` in
 *  `steps` too, and it is the state the marks are there for. */
export function roundUnderWay(g: SpecGroup): boolean {
  const lead = g.lead;
  if (!lead || !inFlight(lead)) return false;
  return lead.steps.slice(lead.stepIndex).some((s) => s === "analyze" || s === "implement");
}
