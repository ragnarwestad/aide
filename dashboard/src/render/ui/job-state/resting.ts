import { jobPresentation } from "./presentation.ts";
import { queueBadge } from "../components/queue-editor";
// What a row's chip says when nothing is running on it.

import { badge } from "../components";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../project/parse-status";
import { t, type Language } from "../../../i18n";
import { capitalizeFirst } from "../../../messages/shared/written.ts";
import { BADGE_VARIANT, currentStep, stateWord } from "./format.ts";
import type { QueueRowView } from "./types.ts";
import { GERUND_EN, GERUND_NB, GERUND_ES, GERUND_DE, GERUND_FR, gerund, landingStepIndex } from "../../../format/gerund.ts";

export { GERUND_EN, GERUND_NB, GERUND_ES, GERUND_DE, GERUND_FR, gerund, landingStepIndex };

/** What the badge says when nothing is running: the resting state and
 *  what can happen next, in one sentence. Handed in rather than worked
 *  out here, because none of it is the JOB's to know — `readyPhase` is
 *  the SPEC's answer, worked out by the caller from the spec's own
 *  files.
 *
 *  There is no "ready to merge the code" state, since no person presses
 *  Merge: every step lands the work it produced, and the one branch left
 *  standing open is `implement`'s, which `archive` lands. `readyPhase`
 *  already says "ready for archive" on exactly that row, so the badge
 *  needs no duplicate. */
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
 *  That is one rule, not one case: the first line is
 *  the verb for what is happening, or the resting state and what is
 *  next. A bare `queued` would say neither, with the step it is
 *  waiting to run known all along, and a bare `done` would say the
 *  resting state without the half that matters. The order of the resting cases came from the
 *  sentence this badge replaced: a branch to merge outranks a phase to
 *  run, and a held-back archive outranks both. */
/** What a row says when nothing is running on it: the resting state,
 *  and what comes next.
 *
 *  The WORD only. The reason is a sentence out of `4-status.md` — 130
 *  characters in one case — and a badge is `nowrap`, so it would run off
 *  the right edge of the table. It is said in full in the row's own panel
 *  instead (`getSpecMessage`), once.
 *
 *  Its own function, because a spec with no job in the
 *  queue's memory needs the same sentence, and a hardcoded "not
 *  started" would let the badge and the Run button beside it, named from
 *  `readyPhase`, disagree on the very same row
 *  ("not started · Implement"). Sharing this makes them agree by
 *  construction. */
// One word each since 2026-08-24 ("ready", "done"): the phase the spec
// is ready FOR is already named by the Run button beside this badge —
// the same `readyPhase` names both, so they cannot disagree — and
// "nothing waiting on you" said nothing "done" does not. The colour
// still tells the two apart at a glance.
export function restingChip(lang: Language, resting: RestingState = {}): string {
  // Two reasons share this one field (spec-lookup.ts): a dependency
  // still open is genuinely waiting on something outside this spec,
  // but unticked Acceptance criteria are this spec's own next step —
  // exactly what "ready" already means everywhere else on this badge,
  // so it reads that way here too. The notice panel below still says
  // which of the two it is, in full.
  if (resting.archiveHeldBack === ACCEPTANCE_CRITERIA_UNTICKED_NOTE) return badge("ready", t(lang, "list.ready"));
  // Why it is held back is the sentence on the row's own notice line.
  if (resting.archiveHeldBack) return badge("waiting", capitalizeFirst(t(lang, "state.heldBack")));
  if (resting.readyPhase) return badge("ready", t(lang, "list.ready"));
  return badge("done", t(lang, "list.done"));
}

/** The step a landing belongs to: the one that just finished. A job in
 *  `done` still points at it; one that has already stepped on to its
 *  next step points one past it. */
export function landingStep(r: { steps: readonly string[]; stepIndex: number; state: QueueRowView["state"] }): string {
  return r.steps[landingStepIndex(r.state, r.stepIndex)] ?? currentStep(r);
}

/** Current operation, using the same wait decision as the phase and filter. */
export function specStateChip(r: QueueRowView, lang: Language, resting: RestingState = {}): string {
  const shown = jobPresentation(r);
  if (shown.waiting?.id) {
    const pos = shown.waiting;
    return queueBadge(lang, pos.id!, pos.n, pos.total, pos.reason, r.state === "queued" && r.steps[r.stepIndex] === "deploy");
  }
  if (["queued", "needs-action", "testing", "merging"].includes(shown.state)) {
    const pos = shown.waiting;
    return badge(shown.variant, pos
      ? t(lang, "list.stateQueuedPosition", { n: pos.n, total: pos.total })
      : capitalizeFirst(stateWord(r, lang)));
  }
  if (r.landing) return badge("running", r.steps[0] === "land" ? stateWord(r, lang) : gerund(lang, landingStep(r)));
  if (r.state === "running") return badge("running", r.steps[0] === "land" ? stateWord(r, lang) : gerund(lang, currentStep(r)));
  if (r.state === "done") return restingChip(lang, resting);
  return badge(BADGE_VARIANT[r.state], capitalizeFirst(stateWord(r, lang)));
}
