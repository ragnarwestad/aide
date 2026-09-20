// The arithmetic and the words behind a bounded field's count. Pure, so the
// boundaries are pinned without a DOM.

/** From this share of the bound the count is marked as a warning. */
const NEAR_NUMERATOR = 9;

export type LimitState = "ok" | "near";

export const limitState = (length: number, bound: number): LimitState =>
  length * 10 >= bound * NEAR_NUMERATOR ? "near" : "ok";

/** `<n> of <bound> characters`, and from the warning on how many are left,
 *  so the warning is not colour alone. */
export const countText = (length: number, bound: number): string =>
  limitState(length, bound) === "near"
    ? `${length} of ${bound} characters, ${Math.max(0, bound - length)} left`
    : `${length} of ${bound} characters`;

export const discardedText = (lost: number, bound: number): string =>
  `${lost} ${lost === 1 ? "character did not fit and was" : "characters did not fit and were"} discarded` +
  ` — this field holds at most ${bound}.`;

/** What the browser threw away: what was pasted, less what the field grew by
 *  and what the paste replaced. Measured from the field after the browser has
 *  acted, so no browser's truncation is re-implemented here. */
export const discarded = (inserted: number, before: number, replaced: number, after: number): number =>
  Math.max(0, inserted - (after - before + replaced));

/** Whether the field ended where a truncation leaves it. One short counts: a
 *  pair of UTF-16 units is never cut in half, so a paste that ends in one
 *  leaves the field a character under its bound. */
export const ended = (after: number, bound: number): boolean => after >= bound - 1;
