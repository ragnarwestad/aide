// What a row's chip says when nothing is running on it.

import { badge, stepLabel } from "../components.ts";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../project/parse-status.ts";
import { BADGE_VARIANT, currentStep } from "./format.ts";
import type { QueueRowView } from "./types.ts";

/** What the badge says when nothing is running: the resting state and
 *  what can happen next, in one sentence. Handed in rather than worked
 *  out here, because none of it is the JOB's to know — `readyPhase` is
 *  the SPEC's answer, worked out by the caller from the spec's own
 *  files.
 *
 *  `mergeReady` was the third of them until spec 149. It said "ready to
 *  merge the code" for a branch a person was expected to press Merge
 *  for, and there is no such press any more: every step lands the work
 *  it produced, and the one branch left standing open is `implement`'s,
 *  which `archive` lands. `readyPhase` already says "ready for archive"
 *  on exactly that row, so the badge kept the answer and lost the
 *  duplicate. */
export interface RestingState {
  archiveHeldBack?: string;
  readyPhase?: string;
}

/** The SPEC row's own chip: a running job reads as "analyzing",
 *  "implementing" — the phase word IS the state, so the row needs no
 *  second sentence saying which step is on (asked for 2026-08-19). The
 *  phase LINES keep the plain "running": their line already names the
 *  phase, and doubling it would say "analyze analyzing".
 *
 *  Spec 132 made that one rule instead of one case: the first line is
 *  the verb for what is happening, or the resting state and what is
 *  next. `queued` said neither — one bare word, with the step it was
 *  waiting to run known all along — and `done` said the resting state
 *  without the half that matters, while the sentence disambiguating it
 *  sat one line lower. The order of the resting cases came from the
 *  sentence this badge replaced: a branch to merge outranks a phase to
 *  run, and a held-back archive outranks both. */
/** What a row says when nothing is running on it: the resting state,
 *  and what comes next.
 *
 *  The WORD only. The reason is a sentence out of `4-status.md` — 130
 *  characters on spec 141 — and a badge is `nowrap`, so it ran off the
 *  right edge of the table. It is said in full in the row's own panel
 *  instead (`specNotice`), once (spec 143).
 *
 *  Its own function since spec 176, because a spec with no job in the
 *  queue's memory needs the same sentence and had a hardcoded "not
 *  started" instead. That row's `readyPhase` was already computed and
 *  sitting unused, and the Run button beside the badge was already
 *  named from it — so the two could disagree on the very same row
 *  ("not started · Implement"). Sharing this makes them agree by
 *  construction. */
// One word each since 2026-08-24 ("ready", "done"): the phase the spec
// is ready FOR is already named by the Run button beside this badge —
// the same `readyPhase` names both, so they cannot disagree — and
// "nothing waiting on you" said nothing "done" does not. The colour
// still tells the two apart at a glance.
export function restingChip(resting: RestingState = {}): string {
  // Two reasons share this one field (spec-lookup.ts): a dependency
  // still open is genuinely waiting on something outside this spec,
  // but unticked Acceptance criteria are this spec's own next step —
  // exactly what "ready" already means everywhere else on this badge,
  // so it reads that way here too. The notice panel below still says
  // which of the two it is, in full.
  if (resting.archiveHeldBack === ACCEPTANCE_CRITERIA_UNTICKED_NOTE) return badge("ready", "ready");
  if (resting.archiveHeldBack) return badge("waiting", "archive held back");
  if (resting.readyPhase) return badge("ready", "ready");
  return badge("done", "done");
}

export function specStateChip(r: QueueRowView, resting: RestingState = {}): string {
  if (r.state === "running") return badge("running", gerund(currentStep(r)));
  if (r.state === "queued") {
    const step = currentStep(r);
    const pos = r.queuePosition;
    return badge(
      "idle",
      pos ? `${gerund(step)} ${pos.n}/${pos.total}` : `${gerund(step)} queued`,
      pos ? `${pos.n} of ${pos.total} queued — waiting for a free slot to run ${stepLabel(step)}` : undefined,
    );
  }
  // The step finished and `state` already reads "done", but its branch
  // has not landed yet (`Runner.complete()` writes both in the same
  // update — `runner.ts`). A row that fell through to `restingChip`
  // here would offer "ready" for a spec whose files do not exist yet.
  if (r.state === "done" && r.landing) return badge("running", gerund(currentStep(r)));
  if (r.state === "done") return restingChip(resting);
  // Bare word only (REQ-1, spec 339) — `stateLabel()`'s "stopped —
  // <reason>" suffix is the notice line's to say now (`lead.error`,
  // verified always populated for every stopReason). `stateChip` still
  // carries the full text, for the job DETAIL page's own big badge
  // (`job-page.ts`, out of REQ-7's scope).
  return badge(BADGE_VARIANT[r.state], r.state);
}

/** "analyze" → "analyzing", "implement" → "implementing" — from the
 *  reader's word (`stepLabel`), so a future entry added to
 *  `STEP_LABELS` gerunds through the same rule rather than a second
 *  one. */
function gerund(step: string): string {
  const label = stepLabel(step);
  return label.endsWith("e") ? `${label.slice(0, -1)}ing` : `${label}ing`;
}
