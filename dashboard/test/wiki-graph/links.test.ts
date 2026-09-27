// Which pages become the graph's points, and which pairs its lines (AC-1's
// pairing half, and AC-2 in full).

import { describe, expect, test } from "bun:test";
import { buildWikiGraph } from "../../src/wiki-graph/links.ts";

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
