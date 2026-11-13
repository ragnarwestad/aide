// The arithmetic and the words behind a bounded field's count. Pure, so the
// boundaries are pinned without a DOM.

/** From this share of the bound the count is marked as a warning. */
const NEAR_NUMERATOR = 9;

export type LimitState = "ok" | "near" | "over";

export const limitState = (length: number, bound: number): LimitState =>
  length > bound ? "over" : length * 10 >= bound * NEAR_NUMERATOR ? "near" : "ok";

/** The count's sentences, `{n}`, `{bound}` and `{left}` filled in. */
export interface LimitWords {
  limitCount: string;
  limitLeft: string;
  limitOverOne: string;
  limitOver: string;
  limitDiscardedOne: string;
  limitDiscarded: string;
}

const ENGLISH: LimitWords = {
  limitCount: "{n} of {bound} characters",
  limitLeft: "{n} of {bound} characters, {left} left",
  limitOverOne: "{n} character too many — this field holds at most {bound}.",
  limitOver: "{n} characters too many — this field holds at most {bound}.",
  limitDiscardedOne: "{n} character did not fit and was discarded — this field holds at most {bound}.",
  limitDiscarded: "{n} characters did not fit and were discarded — this field holds at most {bound}.",
};

/** The words the page's `<body>` carries in the reader's language
 *  (`data-limit-*`), each one English where the page has none. */
export function limitWords(dataset: Partial<Record<string, string>> | undefined): LimitWords {
  const words = { ...ENGLISH };
  for (const key of Object.keys(ENGLISH) as (keyof LimitWords)[]) {
    const word = dataset?.[key];
    if (word) words[key] = word;
  }
  return words;
}

const fill = (text: string, values: Record<string, number>): string =>
  text.replace(/\{(n|bound|left)\}/g, (_, k: string) => String(values[k]));

/** `<n> of <bound> characters`, and from the warning on how many are left,
 *  so the warning is not colour alone. */
export const countText = (length: number, bound: number, words: LimitWords = ENGLISH): string =>
  limitState(length, bound) === "near"
    ? fill(words.limitLeft, { n: length, bound, left: Math.max(0, bound - length) })
    : fill(words.limitCount, { n: length, bound });

/** The line under a field that is counted and never cut, once it holds more
 *  than its bound. */
export const overText = (over: number, bound: number, words: LimitWords = ENGLISH): string =>
  fill(over === 1 ? words.limitOverOne : words.limitOver, { n: over, bound });

export const discardedText = (lost: number, bound: number, words: LimitWords = ENGLISH): string =>
  fill(lost === 1 ? words.limitDiscardedOne : words.limitDiscarded, { n: lost, bound });

/** What the browser threw away: what was pasted, less what the field grew by
 *  and what the paste replaced. Measured from the field after the browser has
 *  acted, so no browser's truncation is re-implemented here. */
export const discarded = (inserted: number, before: number, replaced: number, after: number): number =>
  Math.max(0, inserted - (after - before + replaced));

/** Whether the field ended where a truncation leaves it. One short counts: a
 *  pair of UTF-16 units is never cut in half, so a paste that ends in one
 *  leaves the field a character under its bound. */
export const ended = (after: number, bound: number): boolean => after >= bound - 1;
