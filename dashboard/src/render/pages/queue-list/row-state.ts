// The row-level facts everything else on a spec's rows is built from:
// whether it is busy, what phase it is waiting on, what a press would
// run.

import { currentStep, inFlight, stateLabel } from "../../ui/job-state.ts";
import { stepLabel } from "../../ui/components.ts";
import type { QueuePageOptions } from "../queue-list.ts";
import { QUEUE_STEPS, groupKey, type SpecGroup } from "./data-model.ts";

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
 *  says the same thing rather than each wording it freshly. */
export const busyReason = (g: SpecGroup): string =>
  g.lead ? `${stepLabel(currentStep(g.lead))} is ${g.lead.landing ? "landing" : stateLabel(g.lead)}` : "";

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
// a member of `QUEUE_STEPS` and is deleted before the search, and
// archive is the floor every row still has ahead of it. Not exported,
// and deliberately: a caller outside this page — a summary of specs
// that really ARE archived, say — needs archive counted as done, and
// would be wrong to read this. Anything wanting to export it has to
// come back through this paragraph first.
export function nextPhase(done: readonly string[]): string | undefined {
  const remaining = new Set(done);
  remaining.delete("archive");
  return QUEUE_STEPS.find((s) => !remaining.has(s));
}

// What a press would run, if nothing else is ticked: EVERY phase the
// spec has not had (spec 200). A press takes the spec as far as it can
// go, and unticking a box is how a reader says to stop somewhere. It
// depends on how far the spec has got, and on nothing about which
// phase is asking.
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
// `QUEUE_STEPS` in order with the same archive rule — which is what
// keeps the button and the badge naming the same phase (spec 191).
//
// It used to live inside the strip of chips the controls line drew
// (`stepBoxes`, retired with that line in spec 124). The boxes are on
// the phase lines now and each asks this the same question, so the
// rule is read once per row and consulted per phase.
export function preTicked(g: SpecGroup): Set<string> {
  const remaining = new Set(g.done);
  remaining.delete("archive");
  return new Set(QUEUE_STEPS.filter((s) => !remaining.has(s)));
}

// What the row's one button SAYS, built from the same set the boxes are
// ticked from (spec 157). Two things follow from naming it after the
// ticked phases rather than after the state's own suggestion:
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
// `preTicked()` ticks every phase the spec has left since spec 200, so
// the button names the first of them and not the whole of what a press
// does — deliberately, and the boxes right there on the row say the
// rest. Nothing ticked names nothing: no button is drawn at all,
// because a disabled one invites a press that cannot do anything.
export function actionLabel(g: SpecGroup): string | undefined {
  const ticked = [...preTicked(g)];
  if (ticked.length === 0) return undefined;
  // The FIRST ticked phase, and nothing after it. A "+ 1" suffix said
  // how many more a press would run and was taken out on 2026-08-21:
  // a button label is a name, not a summary, and the phases themselves
  // are one click away on the row the press acts on.
  const first = stepLabel(ticked[0]!);
  return `${first[0]!.toUpperCase()}${first.slice(1)}`;
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
export const refusalFor = (g: SpecGroup, opts: QueuePageOptions): string | undefined =>
  opts.errorSpec && opts.errorSpec === groupKey(g.project, g.specFolder) ? opts.error : undefined;

// The row's own anchor. `id`, not `data-folder`: a badge pointing at
// another spec's row needs something `href="#..."` can find with no
// script at all — this page's own rule. Same shape as `runFormId`, so
// "an id that names a spec" stays the one convention it already is.
export const rowAnchorId = (g: SpecGroup): string => `spec-${groupKey(g.project, g.specFolder)}`;

export { specNumber } from "../../../project/spec-folder.ts";
