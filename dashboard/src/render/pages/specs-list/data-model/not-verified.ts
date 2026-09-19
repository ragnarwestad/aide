/** How many of a spec's Acceptance rows are marked Not verified: a check
 *  that waits for something after deploy. Carried on a live target, an
 *  archived record and the row built from either; absent or 0 draws no
 *  mark and no filter match. */
export interface HasNotVerified {
  notVerified?: number;
}
