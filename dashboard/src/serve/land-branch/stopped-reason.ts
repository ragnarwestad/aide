// Whether a landing leaves a job's error where it is, and what it does
// with the record of a landing that failed.

import type { Job } from "../../queue/queue.ts";
import type { Sentence } from "../../i18n/message.ts";

/** A step that STOPPED — at its own time limit, or on a provider's
 *  usage limit — lands what it did, and its error is the reason it
 *  stopped: the row's full account of it, not a fault the landing
 *  resolved. Asked of the job as it stands when the landing settles,
 *  since the stop is written before then. */
export function keepsItsStopReason(job: Job | undefined): boolean {
  return job?.state === "stopped" && (job.stopReason === "timeout" || job.stopReason === "provider-limit");
}

// What a job remembers of a landing that failed, and who may forget it.
//
// `landingError` is the record of ONE step's landing, named by that step
// (spec 327): a later step's own success leaves it alone, since the two
// are different facts about the same job. Its own step landing later —
// a retry, or the step pressed again — is what resolves it. atlasaurus
// 05's row said "could not assign this spec its number — nothing was
// pushed; run the step again" while the number had been assigned and
// pushed 27 seconds later (2026-09-20).

/** The record to keep when a landing fails: the FIRST one a job hits is
 *  the one worth keeping (spec 327) — a later step's own failure is a
 *  symptom as often as a second, unrelated problem (the incident that
 *  spec is named for was exactly that: an `analyze` push failure,
 *  followed minutes later by an `archive` "cannot fast-forward main"
 *  that was really the same unpushed commit).
 *
 *  "stopped", never "failed", when the project's own suite is what
 *  refused the merge: the row says stopped and draws it amber, and a
 *  sentence that says failed beside it is the row disagreeing with
 *  itself. The step-name prefix this used to compose is redundant with
 *  the badge label the one display site (`row-marks.ts`'s `liveMarks()`)
 *  shows beside it — and a landing runs with nobody's browser attached,
 *  so there is no language here to render `msg` with (REQ-1/REQ-3). */
export function firstLandingError(
  existing: Sentence | Sentence[] | undefined,
  msg: Sentence | Sentence[],
  step: string,
  held: boolean,
): Sentence | Sentence[] {
  return existing ?? { key: held ? ("landing.stepStopped" as const) : ("landing.stepFailed" as const), values: { step }, inner: msg };
}

/** Whether the landing failure a job carries belongs to `step`. */
export function landingErrorOfStep(job: { landingError?: unknown } | undefined, step: string): boolean {
  const e = job?.landingError;
  if (!e || typeof e !== "object" || Array.isArray(e)) return false;
  return (e as { values?: { step?: unknown } }).values?.step === step;
}

/** The patch that takes that record off a job — empty when the record is
 *  another step's, or when there is none. */
export function clearsLandingError(
  job: { landingError?: unknown } | undefined,
  step: string,
): { landingError?: undefined; landingErrorDetail?: undefined } {
  return landingErrorOfStep(job, step) ? { landingError: undefined, landingErrorDetail: undefined } : {};
}
