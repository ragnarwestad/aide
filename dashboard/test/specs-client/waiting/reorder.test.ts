import { describe, expect, test } from "bun:test";
import { dragStarted, dropOrder, dropSide, restoredOrder } from "../../../src/specs-client/waiting/reorder.ts";

// Dragging an entry in the waiting-queue editor: when a press becomes a
// drag, where the row lands, and what a cancelled drag puts back.

describe("dragging a row", () => {
  test("a press becomes a drag only once the pointer has travelled six pixels", () => {
    expect(dragStarted(3, 4)).toBe(false);
    expect(dragStarted(0, 6)).toBe(true);
  });

  test("the top half of a row drops before it, the bottom half after it, and outside it nowhere", () => {
    expect(dropSide(104, 100, 120)).toBe("before");
    expect(dropSide(115, 100, 120)).toBe("after");
    expect(dropSide(121, 100, 120)).toBeUndefined();
  });

  test("the dragged row lands in front of the row it drops before, or last without one", () => {
    expect(dropOrder(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(dropOrder(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
  });

  test("a cancelled drag restores the starting order, keeping rows that joined during it last", () => {
    expect(restoredOrder(["a", "b", "c"], ["b", "a", "d"])).toEqual(["a", "b", "d"]);
  });
});
