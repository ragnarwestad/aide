// How many of a running implement's three TDD parts are behind it.
// Split out of job-state.ts by theme (split job-state.ts by theme).

import { TDD_PHASES } from "../../../queue/aide-run-store.ts";
import type { QueueRowView } from "./types.ts";

/** How many of a running implement's three parts are BEHIND it (spec
 *  210) — what the pip fills in, as `pips()` wants it. Answered about
 *  the ROW, so the "only while it is actually running" half of the rule
 *  is written once rather than at each of the two call sites.
 *
 *  Off by one from the phase's own position, and deliberately: `red` is
 *  the first third being worked on, not the first third finished. A pip
 *  that looked a third done five seconds into RED would misinform about
 *  how far the run has got, which is worse than saying nothing — so
 *  `red` and "no report at all" render identically.
 *
 *  One function, because both places the answer appears — the spec
 *  list's pip strip and the job page's — would otherwise each carry the
 *  same guarded `indexOf`, and a transposition in one of them is a
 *  silent lie about progress. */
export function completedThirds(attempt: QueueRowView | undefined): 1 | 2 | undefined {
  // The state itself, never `inFlight`: that is queued OR running, and a
  // job waiting to start is in no TDD phase at all.
  if (!attempt || attempt.state !== "running") return undefined;
  const tddPhase = attempt.tddPhase;
  if (!tddPhase) return undefined;
  const behind = TDD_PHASES.indexOf(tddPhase);
  return behind === 1 || behind === 2 ? behind : undefined;
}
