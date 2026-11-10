// State labels, durations, the state chip, and "is this job still
// going".

import { durationLabel } from "../../../format/duration.ts";
export { durationLabel };

import { badge, helpPopover, type BadgeVariant } from "../components";
import { esc } from "../html.ts";
import { formatSentence } from "../../../messages/format.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { capitalizeFirst } from "../../../messages/shared/written.ts";
import type { QueueRowView } from "./types.ts";

// Every state is a single catalogue key — added here rather than left
// as `r.state`, which was the raw English enum value in
// every language.
const STATE_LABEL_KEYS: Record<Exclude<QueueRowView["state"], "stopped">, TranslationKey> = {
  queued: "state.queued",
  running: "state.running",
  done: "state.done",
  failed: "state.failed",
  cancelled: "state.cancelled",
  interrupted: "state.interrupted",
};

/** The state, in one word. That word is the whole of what the page says
 *  about a state: why a job stopped — red tests, a provider's limit, the
 *  step's own time limit — is the error sentence's to tell, in the
 *  row's message and the popover beside the chip, and is never written
 *  after the word. */
export function stateWord(r: QueueRowView, lang: Language = "en"): string {
  return r.state === "stopped" ? t(lang, "state.stopped") : t(lang, STATE_LABEL_KEYS[r.state]);
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
//   interrupted — grouped with failed, as it always was.
//   cancelled   — a stop somebody chose, not a failure: the same amber
//                 as stopped, because the step was started and did not
//                 finish, and pressing again is what comes next. Grey
//                 read as "never ran", which a cancelled step is not.
export const BADGE_VARIANT: Record<QueueRowView["state"], BadgeVariant> = {
  queued: "idle",
  running: "running",
  done: "done",
  stopped: "waiting",
  failed: "refused",
  cancelled: "waiting",
  interrupted: "refused",
};

export function stateChip(r: QueueRowView, lang: Language = "en"): string {
  // The word alone (see `stateWord`); why it stopped is what the popover
  // beside it is for.
  const b = badge(BADGE_VARIANT[r.state], capitalizeFirst(stateWord(r, lang)));
  // Why it stopped is the popover's, not the badge's — and a stop with
  // no sentence of its own gets no popover at all.
  const detail = r.state === "stopped" ? formatSentence(lang, r.error) : undefined;
  return detail ? b + helpPopover("why this stopped", esc(detail)) : b;
}

/** Which states mean "still going". The list page's "Active" filter is
 *  built from this rather than the other way round: a state added to one
 *  and forgotten in the other is exactly the drift neither page can
 *  afford, and the single-job page needs the same test without importing
 *  the list's filter vocabulary. */
export { inFlight } from "../../../queue/queue.ts";

export { currentStep } from "../../../messages/jobs/context.ts";
