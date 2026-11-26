// State labels, durations, the state chip, and "is this job still
// going".

import { jobPresentation } from "./presentation.ts";
import { durationLabel } from "../../../format/duration.ts";
export { durationLabel };

import { badge, helpPopover, type BadgeVariant } from "../components";
import { esc } from "../html.ts";
import { formatSentence } from "../../../messages/format.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { capitalizeFirst } from "../../../messages/shared/written.ts";
import { isStepEnding } from "../../../step-endings.ts";
import type { QueueRowView } from "./types.ts";

// Every state is a single catalogue key — added here rather than left
// as `r.state`, which was the raw English enum value in
// every language.
const STATE_LABEL_KEYS: Record<QueueRowView["state"], TranslationKey> = {
  queued: "state.queued",
  waiting: "state.waiting",
  running: "state.running",
  done: "state.done",
  failed: "state.failed",
  cancelled: "state.cancelled",
};

/** The state, in one word. That word is the whole of what the page says
 *  about a state: why a job stopped — red tests, a provider's limit, the
 *  step's own time limit — is the error sentence's to tell, in the
 *  row's message and the popover beside the chip, and is never written
 *  after the word. */
export function stateWord(r: Parameters<typeof jobPresentation>[0], lang: Language = "en"): string {
  const state = jobPresentation(r).state;
  if (state === "needs-action") return t(lang, "state.heldBack");
  if (state === "testing" || state === "merging") return t(lang, `state.${state}`);
  return t(lang, STATE_LABEL_KEYS[state]);
}

/** How a step ended, in one word for a table cell. A reason that is not a
 *  step ending is shown as it is. */
export function endingWord(lang: Language, reason: string): string {
  return isStepEnding(reason) ? t(lang, `ending.${reason}` as TranslationKey) : reason;
}

// A wall of identical grey rows hides the one thing you came to see.
// Colour carries the state; the label still says it in words, so the
// colour is never the only signal.
//
// Ten states, six badge variants. Five of them had an example on the
// design sheet; the other four are decided here:
//
//   stopped     — a cap-stop is a common, healthy outcome (see
//                 `stateLabel` above), so it takes the same amber as
//                 waiting: notice, not alarm.
//   failed      — a real failure, so danger.
//   cancelled   — a stop somebody chose, not a failure: the same amber
//                 as stopped, because the step was started and did not
//                 finish, and pressing again is what comes next. Grey
//                 read as "never ran", which a cancelled step is not.
export const BADGE_VARIANT: Record<QueueRowView["state"], BadgeVariant> = {
  queued: "waiting",
  running: "running",
  done: "done",
  waiting: "waiting",
  failed: "refused",
  cancelled: "waiting",
};

/** Why a job stopped, for the popover beside its state: a job waiting on a
 *  usage limit, and a failed or cancelled job a stop ended first. None for a
 *  stop with no sentence of its own. */
export function whyStopped(r: Pick<QueueRowView, "state" | "stopReason" | "error">, lang: Language = "en"): string | undefined {
  const stopped = r.state === "waiting" || ((r.state === "failed" || r.state === "cancelled") && r.stopReason);
  return stopped ? formatSentence(lang, r.error) : undefined;
}

export function stateChip(r: QueueRowView, lang: Language = "en"): string {
  // The word alone (see `stateWord`); why it stopped is what the popover
  // beside it is for.
  const b = badge(jobPresentation(r).variant, capitalizeFirst(stateWord(r, lang)));
  const detail = whyStopped(r, lang);
  return detail ? b + helpPopover(t(lang, "help.whyStopped"), esc(detail)) : b;
}

/** Which states mean "still going". The list page's "Active" filter is
 *  built from this rather than the other way round: a state added to one
 *  and forgotten in the other is exactly the drift neither page can
 *  afford, and the single-job page needs the same test without importing
 *  the list's filter vocabulary. */
export { inFlight } from "../../../queue/queue.ts";

export { currentStep } from "../../../messages/jobs/context.ts";
