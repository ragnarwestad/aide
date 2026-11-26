// A check that did not finish is no answer: the machine was busy, and
// nothing is known about what it checked. It is said at the top of every
// page only once it has gone unanswered for this long, which a busy
// machine's ordinary load — a merge running the whole test suite — stays
// under.

export const UNANSWERED_FOR_MS = 15 * 60_000;

/** The whole minutes the warning names. */
export const UNANSWERED_MINUTES = UNANSWERED_FOR_MS / 60_000;

/** Whether a check unanswered since `since` (ms) has been so long enough to say. */
export function unansweredLongEnough(since: number, now: number): boolean {
  return now - since >= UNANSWERED_FOR_MS;
}
