import { describe, expect, test } from "bun:test";
import { countText, discarded, discardedText, ended, limitState, limitWords, overText } from "../../../src/specs-client/limits/measure.ts";

describe("the count", () => {
  test("reads how many of how many, and nothing more while there is room", () => {
    expect(countText(0, 120)).toBe("0 of 120 characters");
    expect(countText(5, 120)).toBe("5 of 120 characters");
    expect(countText(37, 5000)).toBe("37 of 5000 characters");
  });

  test("the warning starts at 90% of the bound: 107 is ok, 108 is near, of 120", () => {
    expect(limitState(107, 120)).toBe("ok");
    expect(limitState(108, 120)).toBe("near");
    expect(limitState(120, 120)).toBe("near");
  });

  test("the warning starts at 4,500 of 5,000", () => {
    expect(limitState(4499, 5000)).toBe("ok");
    expect(limitState(4500, 5000)).toBe("near");
  });
});

describe("a field that is counted and never cut", () => {
  test("is over only above the bound; at the bound it is near (AC-4)", () => {
    expect(limitState(10000, 10000)).toBe("near");
    expect(limitState(10001, 10000)).toBe("over");
  });

  test("the count reads against the bound (AC-3)", () => {
    expect(countText(37, 10000)).toBe("37 of 10000 characters");
  });

  test("the sentence says how many characters too many, and the bound (AC-4)", () => {
    expect(overText(120, 10000)).toContain("120 characters too many");
    expect(overText(120, 10000)).toContain("10000");
    expect(overText(1, 10000)).toContain("1 character too many");
  });
});

describe("what the browser threw away", () => {
  test("a paste at the end that the field keeps 50 of loses 50", () => {
    expect(discarded(100, 4950, 0, 5000)).toBe(50);
  });

  test("a paste over a selection counts what the selection made room for", () => {
    // 100 held, 30 selected, 60 pasted: room for 50 more, so 10 lost.
    expect(discarded(60, 100, 30, 120)).toBe(10);
    // 50 pasted over the same selection fits exactly: nothing lost.
    expect(discarded(50, 100, 30, 120)).toBe(0);
  });

  test("a paste into a full field loses all of it", () => {
    expect(discarded(30, 120, 0, 120)).toBe(30);
  });

  test("a paste that fits loses nothing, and the result is never negative", () => {
    expect(discarded(10, 20, 0, 30)).toBe(0);
    expect(discarded(5, 20, 0, 40)).toBe(0);
  });
});

describe("whether the field ended where a truncation leaves it", () => {
  test("at the bound, and one under it for a pair that was not cut in half", () => {
    expect(ended(120, 120)).toBe(true);
    expect(ended(119, 120)).toBe(true);
    expect(ended(118, 120)).toBe(false);
  });
});

// The count's words come off the page, in the reader's language; with no
// words on the page they are English.
describe("the count's words", () => {
  const words = limitWords({
    limitCount: "{n} av {bound} tegn", limitLeft: "{n} av {bound} tegn, {left} igjen",
    limitOverOne: "{n} tegn for mye (maks {bound})", limitOver: "{n} tegn for mye (maks {bound})",
    limitDiscardedOne: "{n} tegn ble kastet (maks {bound})", limitDiscarded: "{n} tegn ble kastet (maks {bound})",
  });

  test("are built from the words the page gives (AC-2)", () => {
    expect(countText(5, 120, words)).toBe("5 av 120 tegn");
    expect(countText(110, 120, words)).toBe("110 av 120 tegn, 10 igjen");
    expect(overText(3, 100, words)).toBe("3 tegn for mye (maks 100)");
    expect(discardedText(1, 100, words)).toBe("1 tegn ble kastet (maks 100)");
  });

  test("are today's English when the page gives none (AC-2)", () => {
    const english = limitWords(undefined);
    expect(countText(110, 120, english)).toBe("110 of 120 characters, 10 left");
    expect(overText(1, 100, english)).toBe("1 character too many — this field holds at most 100.");
    expect(discardedText(2, 100, english)).toBe("2 characters did not fit and were discarded — this field holds at most 100.");
  });
});
