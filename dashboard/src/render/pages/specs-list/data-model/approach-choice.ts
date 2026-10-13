// The pending approach choice a target and a row carry: the real
// alternatives a ticked spec's analysis found, while none is chosen. And
// the four settings the spec was created with, choosing the approach among
// them, which the Running tab's open row changes.

import type { Approach } from "../../../../project/approach-choice.ts";
import type { CreateChoices } from "../../../../project/discover";

/** Carried on a live target and the row built from it; absent when no
 *  choice waits. */
export interface HasApproachChoice {
  /** The real alternatives, recommended one included, in the plan's order. */
  approachChoice?: Approach[];
}

/** Carried on a live target and the row built from it; absent before the
 *  scan has read the spec's 1-description.md. */
export interface HasCreateChoices {
  createChoices?: CreateChoices;
}
