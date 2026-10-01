// The sortable heading both schedule lists draw: which column and
// direction an address asks for, where each heading leads, and the
// address escaped once.
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { queryHref, resolveSort, sortHeading, type SortColumns } from "../../../../src/render/pages/schedule-page/sort-head.ts";

const COLS: SortColumns = { keys: ["a", "b"], fallback: "a", firstDir: { a: "asc", b: "desc" } };

function th(html: string): { href: string | null; sort: string | null; text: string } {
  const window = new Window();
  window.document.body.innerHTML = `<table><thead><tr>${html}</tr></thead></table>`;
  const cell = window.document.querySelector("th")!;
  return { href: cell.querySelector("a")?.getAttribute("href") ?? null, sort: cell.getAttribute("aria-sort"), text: cell.textContent ?? "" };
}

describe("resolveSort", () => {
  test("takes a known column and direction as they are (AC-5)", () => {
    expect(resolveSort(COLS, { sort: "b", dir: "asc" })).toEqual({ sort: "b", dir: "asc" });
  });

  test("an unknown column is the fallback, an unknown direction the column's first (AC-5)", () => {
    expect(resolveSort(COLS, { sort: "zzz" })).toEqual({ sort: "a", dir: "asc" });
    expect(resolveSort(COLS, { sort: "b", dir: "up" })).toEqual({ sort: "b", dir: "desc" });
    expect(resolveSort(COLS, {})).toEqual({ sort: "a", dir: "asc" });
  });
});

describe("queryHref", () => {
  test("writes every key that has a value, in the order given, encoded (AC-5)", () => {
    expect(queryHref("/x", { run: "r 1", sort: "", dir: undefined, q: "a&b" })).toBe("/x?run=r%201&q=a%26b");
  });

  test("is the path alone when no key has a value (AC-5)", () => {
    expect(queryHref("/x", { sort: "" })).toBe("/x");
  });
});

describe("sortHeading", () => {
  const href = (sort: string, dir: string): string => queryHref("/x", { k: "1", sort, dir });

  test("the sorted column is marked and turns round (AC-5)", () => {
    expect(th(sortHeading(COLS, { sort: "a", dir: "asc" }, "a", "A", href))).toEqual({
      href: "/x?k=1&sort=a&dir=desc", sort: "ascending", text: "A",
    });
    expect(th(sortHeading(COLS, { sort: "b", dir: "desc" }, "b", "B", href)).sort).toBe("descending");
  });

  test("another column links to its first direction, with dir left out (AC-5)", () => {
    expect(th(sortHeading(COLS, { sort: "a", dir: "asc" }, "b", "B", href))).toEqual({
      href: "/x?k=1&sort=b", sort: null, text: "B",
    });
  });

  test("escapes the address and the label once (AC-5)", () => {
    const cell = sortHeading(COLS, { sort: "a", dir: "asc" }, "b", "B & <C>", href);
    expect(cell).toContain('href="/x?k=1&amp;sort=b"');
    expect(th(cell).text).toBe("B & <C>");
  });
});
