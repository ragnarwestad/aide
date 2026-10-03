// The pending approach choice a target and a row carry: the real
// alternatives a ticked spec's analysis found, while none is chosen.

import type { Approach } from "../../../../project/approach-choice.ts";

/** Carried on a live target and the row built from it; absent when no
 *  choice waits. */
export interface HasApproachChoice {
  /** The real alternatives, recommended one included, in the plan's order. */
  approachChoice?: Approach[];
}
