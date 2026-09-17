// The row-level facts everything else on a spec's rows is built from:
// whether it is busy, what phase it is waiting on, what a press would
// run.

import { currentStep, inFlight, stateLabel } from "../../ui/job-state";
import { gerund, landingStep } from "../../ui/job-state/resting.ts";
import { stepLabel } from "../../ui/components";
import { stepButton } from "../../../format/step-label.ts";
import type { SpecsPageOptions } from "./";
import { RUN_STEPS, groupKey, type SpecGroup } from "./data-model";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../project/parse-status";
import type { QueueRowView } from "../../ui/job-state/types.ts";

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

/** Why the row will not take a click, in the words the badge uses. One
 *  sentence for the whole row: about the JOB, so every locked control
 *  says the same thing rather than each wording it freshly.
 *
 *  A landing in flight names the step whose MERGE is actually running —
 *  `landingStep`'s own rule (spec 399, REQ-3), the same one the row's
 *  badge (`specStateChip`) uses — not `currentStep()`, which names the
 *  wrong step once the job has already advanced to `queued` on its next
 *  one while the previous step's branch is still merging. */
export const busyReason = (g: SpecGroup): string => {
  if (!g.lead) return "";
  if (g.lead.landing) {
    const step = landingStep(g.lead);
    return `${stepLabel(step)} is ${gerund("en", step)}`;
  }
  return `${stepLabel(currentStep(g.lead))} is ${stateLabel(g.lead)}`;
};

// THE phase a spec is still waiting on — one fact, read by both halves
// of the State column, so the badge and the button beside it cannot
// name different phases (spec 191). They used to work it out apart:
// this rule lived in `preTicked` below for the button's sake, and
// `specHeadRow` asked `g.done` raw for the badge's. A spec whose
// history listed every step therefore got "done — nothing waiting on
// you" beside a button reading "Archive", and the button was right.
//
// ARCHIVE IS NEVER DONE ON A ROW THAT EXISTS. Archived-ness is a
// directory (`discover.ts`): a spec the list shows is a spec still in
// the active root, so whatever the git history says about an archive
// step having RUN, it did not finish the one thing archiving is.
//
// The history is the record of steps that ran (spec 154), and an
// archive that ran and declined to move the folder leaves a commit
// behind exactly like one that moved it. Counted as done it left spec
// 159 with every phase ticked, no next phase to suggest and no button
// at all — beside a badge reading "archive held back", which was the
// one thing on that row needing a press. The first fix read the
// held-back note and dropped that phase; too narrow, and spec 161
// showed why hours later — with the note cleared the row went to
// "done — nothing waiting on you" while the spec sat unarchived in
// the list. The note is a REASON archiving did not happen, not the
// only evidence that it did not (2026-08-21).
//
// So this never comes back empty for a spec on this page: `archive` is
// a member of `RUN_STEPS` and is deleted before the search, and
// archive is the floor every row still has ahead of it. Not exported,
// and deliberately: a caller outside this page — a summary of specs
// that really ARE archived, say — needs archive counted as done, and
// would be wrong to read this. Anything wanting to export it has to
// come back through this paragraph first.
export function nextPhase(done: readonly string[]): string | undefined {
  const remaining = new Set(done);
  remaining.delete("archive");
  return RUN_STEPS.find((s) => !remaining.has(s));
}

// What a press would run, if the reader had never touched a box: EVERY
// phase the spec has not had (spec 200). A press takes the spec as far
// as it can go, and unticking a box is how a reader says to stop
// somewhere. It depends on how far the spec has got, and on nothing
// about which phase is asking.
//
// `done` is what the spec's own git history PROVES (spec 154): the
// runner commits every step it finishes, and only such a commit puts a
// step here — a `4-status.md` line naming a step is a claim the row
// reports a disagreement about, never a source. A step run at
// somebody's keyboard counts once it is committed with the same
// subject, which is what the skills now offer to do; declined, the
// spec reads as still having that phase ahead of it.
//
// `archive` is deleted from that set for the same reason `nextPhase`
// deletes it: a spec on this list is by definition not archived,
// however its history reads. That is also what keeps the result from
// ever being empty, so the row always has a button — the bug spec
// 159/161 each patched with a fallback of its own, structurally gone
// rather than guarded against a third time. Two branches went with
// those fallbacks: whether the spec has ever had a job at all
// (`g.lead`) made no difference to the answer once every remaining
// phase is ticked, so it is not asked any more.
//
// The first member of this set is `nextPhase(g.done)` — both walk
// `RUN_STEPS` in order with the same archive rule — which is what
// keeps the button and the badge naming the same phase (spec 191).
//
// Renamed from `preTicked()` (spec 439): this is no longer the only
// answer to "what is ticked" — it is `chosenSteps()`'s own fallback now,
// for a spec that has never had a create or a Run recorded under that
// fix. It used to live inside the strip of chips the controls line drew
// (`stepBoxes`, retired with that line in spec 124). The boxes are on
// the phase lines now and each asks this the same question, so the
// rule is read once per row and consulted per phase.
function defaultTicked(g: SpecGroup): Set<string> {
  const remaining = new Set(g.done);
  remaining.delete("archive");
  return new Set(RUN_STEPS.filter((s) => !remaining.has(s)));
}

// What the row's boxes are ticked FROM (spec 439): a phase choice
// recorded at create time, or at the reader's own later Run —
// `opts.pendingSteps`, keyed `project/specFolder` the same way
// `pendingModels`/`pendingEffort` already are — when one is on record,
// and `defaultTicked()` above only as the fallback for a spec that has
// never had either kind of submission recorded under this fix.
//
// Before spec 439 there was only `preTicked()`, a pure function of git
// history with no way for a reader's own choice to survive past the job
// that made it: the create-time ticks a fresh spec was given, or the
// ticks left on a row after a later Run, were both gone the moment the
// page next redrew (1-description.md's own bug report). This is what
// closes that gap.
export function chosenSteps(g: SpecGroup, opts: { pendingSteps?: Record<string, string[]> }): Set<string> {
  const recorded = opts.pendingSteps?.[groupKey(g.project, g.specFolder)];
  const chosen = recorded ? new Set(recorded) : defaultTicked(g);
  // Held back on its checks: archive is what comes next, and the round
  // offered beside it is a choice the reader makes by ticking. The
  // remembered choice names the chain that has just run, and ticked
  // again it turned a press meant for archive into another round.
  if (heldBackOnChecks(g)) {
    chosen.delete("analyze");
    chosen.delete("implement");
    chosen.add("archive");
  }
  return chosen;
}

// What the row's one button SAYS, and whether a press on it would do
// anything (spec 439 added the second half). Two things follow from
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
// Before spec 439 this was `actionLabel()`, returning a label or
// `undefined` with no room for a third state — "named, but not ticked".
// Because `defaultTicked()`'s own archive-floor rule never came back
// empty, "nothing ticked" was unreachable for an ordinary row and the
// button read "Archive", always active, the moment analyze and
// implement were both done — whatever the reader had actually ticked
// (AC-5's own bug). `active` is what lets the button stay named without
// claiming a press would do something it would not.
export function actionState(
  g: SpecGroup,
  opts: { pendingSteps?: Record<string, string[]> },
): { label: string; active: boolean } | undefined {
  const next = nextPhase(g.done); // unchanged: still the archive-floor rule, still "which phase is next"
  if (!next) return undefined;
  const chosen = chosenSteps(g, opts);
  // From `next` onward, never before it: a phase already done is never
  // what a press would run, whatever a stale recorded choice still
  // names (3-solution.md's own Risk analysis — a chosen-but-not-yet-run
  // phase that later finishes is simply never looked at again).
  const remaining = RUN_STEPS.slice(RUN_STEPS.indexOf(next));
  const firstTicked = remaining.find((s) => chosen.has(s));
  // AC-4: a later ticked phase is named ahead of an earlier unticked
  // one. AC-3: with nothing ticked at all, `next` itself is named,
  // disabled — a press that cannot do anything is still named for what
  // it would take to make it do something, rather than hidden.
  const shown = firstTicked ?? next;
  return { label: stepButton(shown), active: !!firstTicked };
}

// The run form's own id. It exists for the rarely-set fields' sake
// alone: they are written after the form's closing tag, on the same
// line, and `form="<id>"` is what makes the browser post them with it
// anyway.
export const runFormId = (g: SpecGroup): string => `rowrun-${groupKey(g.project, g.specFolder)}`;

// Why the button you just pressed did nothing, and whether it was
// pressed on THIS row. The same key the fold state is written in, so
// no second format for "which spec" is invented.
//
// It is drawn in the row's panel and no longer in the name cell (spec
// 151): the sentence is a whole one — "analyze on 150-… is already
// running (job 03238f57) — cancel that one first if you want to start
// over" — and the name cell is sized for a folder name, so it pushed
// the branch marks and the title around underneath it.
export const refusalFor = (g: SpecGroup, opts: SpecsPageOptions): string | undefined =>
  opts.errorSpec && opts.errorSpec === groupKey(g.project, g.specFolder) ? opts.error : undefined;

// The row's own anchor. `id`, not `data-folder`: a badge pointing at
// another spec's row needs something `href="#..."` can find with no
// script at all — this page's own rule. Same shape as `runFormId`, so
// "an id that names a spec" stays the one convention it already is.
export const rowAnchorId = (g: SpecGroup): string => `spec-${groupKey(g.project, g.specFolder)}`;

export { specNumber } from "../../../project/spec-folder.ts";

// --- spec 471: another round on a spec held back on its checks -------------
/** The steps another round runs. `archive` is offered from a held-back
 *  row already (`finished` excludes it), and `create` never runs twice. */
const ROUND_STEPS = new Set(["analyze", "implement"]);

/** The archive step's own refusal, as the RUNNER leaves it: the
 *  mechanical precheck turns the step away before any model is spawned,
 *  and the job it belongs to finishes `done` with no error of its own.
 *  So the only trace on the row is the step result's reason — which is
 *  why this is read as well as the note below, and not instead of it. */
const PRECHECK_REFUSAL = "acceptance-criteria-unticked";

const refusedForChecks = (a: QueueRowView): boolean =>
  (a.results ?? []).some((r) => r.step === "archive" && r.terminalReason === PRECHECK_REFUSAL);

/** Is this spec waiting on a person to judge its acceptance criteria?
 *  Two records say so and either may be the only one there: the note
 *  `4-status.md` carries once an archive RUN wrote it, and the step
 *  result a run refused before that. */
export function heldBackOnChecks(g: SpecGroup): boolean {
  const archive = g.phases.find((p) => p.step === "archive");
  if (!archive) return false;
  return archive.heldBack?.reason === ACCEPTANCE_CRITERIA_UNTICKED_NOTE ||
    archive.attempts.some(refusedForChecks);
}

/** Would a press on this phase's box start the round again? The row
 *  asks only what it can answer without git; whether the round may
 *  actually start — every open criterion new or changed since the round
 *  boundary — is the run route's own gate, and its refusal names the
 *  criterion that has not moved. */
export function offersAnotherRound(g: SpecGroup, step: string): boolean {
  return ROUND_STEPS.has(step) && heldBackOnChecks(g);
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
