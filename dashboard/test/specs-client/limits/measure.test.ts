import { describe, expect, test } from "bun:test";
import { countText, discarded, discardedText, ended, limitState } from "../../../src/specs-client/limits/measure.ts";

describe("the count", () => {
  test("reads how many of how many, and nothing more while there is room (AC-1)", () => {
    expect(countText(0, 120)).toBe("0 of 120 characters");
    expect(countText(5, 120)).toBe("5 of 120 characters");
    expect(countText(37, 5000)).toBe("37 of 5000 characters");
  });

  test("the warning starts at 90% of the bound: 107 is ok, 108 is near, of 120 (AC-4)", () => {
    expect(limitState(107, 120)).toBe("ok");
    expect(limitState(108, 120)).toBe("near");
    expect(limitState(120, 120)).toBe("near");
  });

  test("the warning starts at 4,500 of 5,000 (AC-4)", () => {
    expect(limitState(4499, 5000)).toBe("ok");
    expect(limitState(4500, 5000)).toBe("near");
  });

  test("a count in the warning says how many are left, so it is not colour alone (AC-4)", () => {
    expect(countText(108, 120)).toBe("108 of 120 characters, 12 left");
    expect(countText(5000, 5000)).toBe("5000 of 5000 characters, 0 left");
  });
});

describe("the discarded-text sentence", () => {
  test("names how many characters did not fit and the field's bound (AC-2)", () => {
    expect(discardedText(240, 120)).toBe(
      "240 characters did not fit and were discarded — this field holds at most 120.",
    );
  });

  test("one character reads in the singular (AC-2)", () => {
    expect(discardedText(1, 120)).toBe("1 character did not fit and was discarded — this field holds at most 120.");
  });
});

describe("what the browser threw away", () => {
  test("a paste at the end that the field keeps 50 of loses 50 (AC-2)", () => {
    expect(discarded(100, 4950, 0, 5000)).toBe(50);
  });

  test("a paste over a selection counts what the selection made room for (AC-2)", () => {
    // 100 held, 30 selected, 60 pasted: room for 50 more, so 10 lost.
    expect(discarded(60, 100, 30, 120)).toBe(10);
    // 50 pasted over the same selection fits exactly: nothing lost.
    expect(discarded(50, 100, 30, 120)).toBe(0);
  });

  test("a paste into a full field loses all of it (AC-2)", () => {
    expect(discarded(30, 120, 0, 120)).toBe(30);
  });

  test("a paste that fits loses nothing, and the result is never negative (AC-2)", () => {
    expect(discarded(10, 20, 0, 30)).toBe(0);
    expect(discarded(5, 20, 0, 40)).toBe(0);
  });
});

describe("whether the field ended where a truncation leaves it", () => {
  test("at the bound, and one under it for a pair that was not cut in half (AC-2)", () => {
    expect(ended(120, 120)).toBe(true);
    expect(ended(119, 120)).toBe(true);
    expect(ended(118, 120)).toBe(false);
  });
});
