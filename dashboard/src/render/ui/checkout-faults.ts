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

const faults = new Map<string, string>();

export function setCheckoutFault(project: string, said: string): void {
  faults.set(project, said);
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

/** One entry per project, in the order they were first reported. */
export function checkoutFaults(): { project: string; said: string }[] {
  return [...faults].map(([project, said]) => ({ project, said }));
}
