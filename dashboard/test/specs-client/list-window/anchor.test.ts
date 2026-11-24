import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { heldRow, holdListAnchor } from "../../../src/specs-client/list-window/anchor.ts";

test("a row the sort moves away is not followed: the row below it on screen is held", () => {
  // The running job at the top of the view finishes and drops to the end.
  expect(heldRow(["run", "b", "c"], ["a", "run", "b", "c", "d"], ["a", "b", "c", "d", "run"])).toBe("b");
  // A row from below jumps to the top: the first row on screen still holds.
  expect(heldRow(["run", "b"], ["a", "run", "b", "d"], ["d", "a", "run", "b"])).toBe("run");
});

test("rows coming and going above the view leave the first row on screen held", () => {
  expect(heldRow(["b", "c"], ["a", "b", "c"], ["new", "b", "c"])).toBe("b");
  expect(heldRow(["b", "c"], ["a", "b", "c"], ["c"])).toBe("c");
  expect(heldRow(["b"], ["a", "b"], ["a"])).toBeUndefined();
});

const saved = { getComputedStyle: globalThis.getComputedStyle };
afterEach(() => Object.assign(globalThis, saved));

/** A page scrolled to `scrollY`, its rows standing where `tops` says before and after the redraw. */
const page = (scrollY: number) => {
  const window = new Window({ height: 600 });
  window.document.body.innerHTML = `<div id="jobrows"><div class="tablewrap"><table><tbody>` +
    `<tr class="spechead" id="spec-a"></tr><tr class="spechead" id="spec-b"></tr></tbody></table></div></div>`;
  const tops: Record<string, number> = { "spec-a": 0, "spec-b": 40 };
  for (const row of window.document.querySelectorAll("tr")) {
    (row as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = () => ({ top: tops[row.id]!, bottom: tops[row.id]! + 40 });
  }
  const wrap = window.document.querySelector(".tablewrap") as unknown as { getBoundingClientRect: () => object };
  wrap.getBoundingClientRect = () => ({ top: 0, bottom: 600 });
  const scrolledBy: number[] = [];
  Object.assign(globalThis, { getComputedStyle: () => ({ overflowY: "visible" }) });
  Object.defineProperty(window, "scrollY", { value: scrollY });
  (window as unknown as { scrollBy: (x: number, y: number) => void }).scrollBy = (_x, y) => void scrolledBy.push(y);
  return { body: window.document.getElementById("jobrows") as unknown as Element, tops, scrolledBy };
};

test("at the top of the page the list stays at the top while rows change", () => {
  const top = page(0);
  const restore = holdListAnchor(top.body);
  top.tops["spec-a"] = 80;
  restore();
  expect(top.scrolledBy).toEqual([]);
  const down = page(200);
  const hold = holdListAnchor(down.body);
  down.tops["spec-a"] = 80;
  down.tops["spec-b"] = 120;
  hold();
  expect(down.scrolledBy).toEqual([80]);
});
