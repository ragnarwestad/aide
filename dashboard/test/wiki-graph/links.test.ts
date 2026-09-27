// Which pages become the graph's points, and which pairs its lines (AC-1's
// pairing half, and AC-2 in full), and which points a given one leads to
// (AC-8's hover highlight).

import { describe, expect, test } from "bun:test";
import { buildWikiGraph, neighbors } from "../../src/wiki-graph/links.ts";

describe("buildWikiGraph (AC-1)", () => {
  test("one point per page given, named with its title (AC-1)", () => {
    const { points } = buildWikiGraph([
      { page: "a.md", title: "A", body: "" },
      { page: "b.md", title: "B", body: "" },
    ]);
    expect(points).toEqual([{ page: "a.md", title: "A" }, { page: "b.md", title: "B" }]);
  });

  test("a pair linked both ways is one pair, and a third page linked from A is a second pair (AC-2)", () => {
    const { pairs } = buildWikiGraph([
      { page: "a.md", title: "A", body: "See [B](b.md) and [C](c.md)." },
      { page: "b.md", title: "B", body: "Back to [A](a.md)." },
      { page: "c.md", title: "C", body: "" },
    ]);
    expect(pairs).toEqual([{ a: 0, b: 1 }, { a: 0, b: 2 }]);
  });

  test("a link to a page that is not among those given adds no pair (AC-2)", () => {
    const { pairs } = buildWikiGraph([{ page: "a.md", title: "A", body: "See [Gone](gone.md)." }]);
    expect(pairs).toEqual([]);
  });

  test("a link to the page's own name adds no pair (AC-2)", () => {
    const { pairs } = buildWikiGraph([{ page: "a.md", title: "A", body: "See [self](a.md)." }]);
    expect(pairs).toEqual([]);
  });

  test("b.md#section counts as a link to B (AC-2)", () => {
    const { pairs } = buildWikiGraph([
      { page: "a.md", title: "A", body: "See [B](b.md#section)." },
      { page: "b.md", title: "B", body: "" },
    ]);
    expect(pairs).toEqual([{ a: 0, b: 1 }]);
  });

  test("two links to the same page make one pair, not two (AC-2)", () => {
    const { pairs } = buildWikiGraph([
      { page: "a.md", title: "A", body: "See [B](b.md) and again [B](b.md#x)." },
      { page: "b.md", title: "B", body: "" },
    ]);
    expect(pairs).toEqual([{ a: 0, b: 1 }]);
  });
});

describe("neighbors (AC-8)", () => {
  test("a point linked both as a pair's a and as a pair's b returns both other ends (AC-8)", () => {
    const pairs = [{ a: 0, b: 1 }, { a: 1, b: 2 }];
    expect(neighbors(1, pairs)).toEqual(new Set([0, 2]));
  });

  test("a point with no pair at all has no neighbors (AC-8)", () => {
    expect(neighbors(3, [{ a: 0, b: 1 }])).toEqual(new Set());
  });

  test("a point does not neighbor itself even if a pair were malformed", () => {
    expect(neighbors(0, [{ a: 0, b: 1 }, { a: 2, b: 3 }])).toEqual(new Set([1]));
  });
});
