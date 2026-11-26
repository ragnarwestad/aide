// What the dashboard could not make sense of in a project's own
// checkout, kept for the line under the header every page shares.
//
// The refusal used to reach a log file and nothing else: woodstack's
// checkout went missing on 2026-09-21, the queue said so once at
// 09:03, and what a reader saw on the board was four rows with no
// number and the wrong state. A checkout the dashboard will not touch
// is the board's own state, not a project's, so it belongs at the top
// of the screen with the install warning and the tool faults.
//
// Process-lifetime state, read by `headerNotices` directly, on
// `pending-restart.ts`'s precedent: `complain` (serve/project-checkout.ts)
// is the one writer, and a project whose checkout is answered for again
// clears its own entry.
//
// `recheck` marks a warning left by a check git did not finish: nothing
// is known yet, and the drift poll asks again rather than leaving it to
// the five-minute sweep. Such a warning is said only once the checkout has
// gone unanswered for `UNANSWERED_FOR_MS`, and never over an answer git
// did give.

import { unansweredLongEnough } from "./faults/unanswered.ts";

const faults = new Map<string, { said: string; recheck: boolean; since?: number }>();

export function setCheckoutFault(project: string, said: string, recheck = false, now: number = Date.now()): void {
  if (!recheck) {
    faults.set(project, { said, recheck });
    return;
  }
  const before = faults.get(project);
  if (before && !before.recheck) return;
  faults.set(project, { said, recheck, since: before?.since ?? now });
}

export function clearCheckoutFault(project: string): void {
  faults.delete(project);
}

/** Every entry, for a board that is shutting down: the faults belong to
 *  a running server, so `stop()` leaves none behind for the next one in
 *  the same process — which in the tests is the next test file. */
export function clearCheckoutFaults(): void {
  faults.clear();
}

/** One entry per project to say, in the order they were first reported:
 *  an unfinished check only once it has gone unanswered long enough. */
export function checkoutFaults(now: number = Date.now()): { project: string; said: string; recheck: boolean }[] {
  return [...faults]
    .filter(([, fault]) => !fault.recheck || unansweredLongEnough(fault.since ?? now, now))
    .map(([project, { said, recheck }]) => ({ project, said, recheck }));
}

/** The projects whose warning is marked to be checked again soon. */
export function checkoutsToRecheck(): string[] {
  return [...faults].filter(([, fault]) => fault.recheck).map(([project]) => project);
}

export function checkoutFaultPresentation(recheck: boolean): { variant: "waiting" | "failed"; dismissible: boolean } {
  return { variant: recheck ? "waiting" : "failed", dismissible: recheck };
}
