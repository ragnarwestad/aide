import { describe, expect, test } from "bun:test";
import { flush, harness } from "../fixtures.ts";

// Spec 522, AC-4: a Failed note that arrives in a redrawn row is counted like
// one on the page at load. `swapRows()` is the one function every redraw of the
// list goes through, so it has to draw the counts itself.
describe("a redrawn list draws the count under a bounded field (spec 522)", () => {
  test("a note field swapped in is given its count once (AC-4)", async () => {
    const NOTE = '<tr id="a"><td><textarea class="failnote" maxlength="500"></textarea></td></tr>';
    const h = harness(() => ({ ok: true, text: NOTE }));
    const after: unknown[][] = [];
    const doc = { createElement: () => ({ setAttribute: () => {}, textContent: "" }) };
    const field = {
      ownerDocument: doc,
      value: "",
      getAttribute: (n: string) => (n === "maxlength" ? "500" : null),
      hasAttribute: (n: string) => n === "maxlength",
      after: (...nodes: unknown[]) => void after.push(nodes),
    };
    const rows = h.rows as unknown as { querySelectorAll: (sel: string) => unknown[] };
    const answer = rows.querySelectorAll;
    rows.querySelectorAll = (sel: string) => (sel.includes("maxlength") ? [field] : answer(sel));
    h.visibility("visible");
    h.live()!.emit("changed");
    await flush();
    expect(after).toHaveLength(1);
    expect(after[0]).toHaveLength(2);
  });
});
