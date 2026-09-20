// The Test servers table is a `table.list` with columns of its own. Its
// widths are percentages of a table that is 100% of the page's frame, so
// the row fills the page and never grows past it; Branch, Project and
// Status leave one at a time as the window narrows. What a browser
// measures of this is in test/e2e/phone/test-servers-table-fits-a-phone.test.ts.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../../src/render/ui/css/list.css", import.meta.url), "utf8");

describe("the test servers table's columns", () => {
  test("four sets of six widths, each a percentage or 0, each adding up to 100 (AC-1)", () => {
    const cols = [...css.matchAll(/col\[data-col="ts-[\w]+"\] \{ width: (?:([\d.]+)%|0;)/g)].map((m) => parseFloat(m[1] ?? "0"));
    expect(cols).toHaveLength(24);
    for (let i = 0; i < cols.length; i += 6) {
      expect(cols.slice(i, i + 6).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
    }
    expect(css).not.toMatch(/col\[data-col="ts-\w+"\] \{ width: (auto|[\d.]+(rem|px))/);
  });

  test("the table is fixed-layout and 100% of its box, with no cap of its own (AC-1)", () => {
    const rule = css.match(/table\.list\.testservers \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/table-layout:\s*fixed/);
    expect(rule).toMatch(/width:\s*100%/);
    expect(rule).not.toMatch(/max-width|min-width/);
  });

  test("its body cells share the specs list's spec-row rules, in the same rule (AC-2)", () => {
    expect(css).toMatch(
      /table\.list tr\.spechead td,\s*table\.list\.testservers tbody td \{[^}]*border-top: 2px solid var\(--line-strong\)/,
    );
    expect(css).toMatch(
      /table\.list tbody tr\.spechead:first-child td,\s*table\.list\.testservers tbody tr:first-child td \{ border-top: none; \}/,
    );
  });

  test("Branch, then Project, then Status leave as columns, each with a width of 0 (AC-3)", () => {
    const steps = [
      ...css.matchAll(
        /@media \(max-width: ([\d.]+)rem\) \{\s*table\.testservers > colgroup > col\[data-col="(ts-\w+)"\] \{ visibility: collapse; \}([\s\S]*?)\n\}/g,
      ),
    ].map((m) => ({ at: parseFloat(m[1]!), hides: m[2], body: m[3]! }));
    expect(steps.map((s) => s.hides)).toEqual(["ts-branch", "ts-project", "ts-status"]);
    const ats = steps.map((s) => s.at);
    expect([...ats].sort((a, b) => b - a)).toEqual(ats);
    expect(ats.every((a) => a > 40)).toBe(true);
    for (const s of steps) {
      expect(s.body).toContain(`col[data-col="${s.hides}"] { width: 0; }`);
    }
  });

  // A fixed layout gives widths to the cells that are left by POSITION, so
  // a cell taken out of a row with display: none puts the cells after it
  // under the wrong column's width.
  test("no cell of this table is taken out of its row (AC-3)", () => {
    expect(css).not.toMatch(/table\.testservers [^{]*(th|td)\[data-col[^{]*\{[^}]*display:\s*none/);
  });
});
