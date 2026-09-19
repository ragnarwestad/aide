/** How many of a spec's Acceptance rows are marked Not verified: a check
 *  that waits for something after deploy. Carried on a live target, an
 *  archived record and the row built from either; absent or 0 draws no
 *  mark and no filter match. */
export interface HasNotVerified {
  notVerified?: number;
  /** How many Acceptance rows are marked Failed: the check was made after the
   *  deploy and did not hold. Counted, marked and filtered with the rest. */
  failed?: number;
}
