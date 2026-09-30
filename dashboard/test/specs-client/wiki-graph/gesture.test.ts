// What a pointer sequence over the graph means (AC-3): a drag of a point,
// a pan of the background, a pinch once a second pointer joins, whether
// the closing click is swallowed, and whether the graph counts as active.

import { describe, expect, test } from "bun:test";
import {
  idleGesture, isActive, pointerCancel, pointerDown, pointerMove, pointerUp,
} from "../../../src/specs-client/wiki-graph/gesture.ts";

describe("a drag of a point (AC-3)", () => {
  test("one pointer down on a point, moved past the threshold, reports a drag of that point", () => {
    let state = pointerDown(idleGesture(), 1, { x: 10, y: 10 }, { type: "point", index: 3 });
    expect(state.kind).toBe("drag");
    expect(state.target).toEqual({ type: "point", index: 3 });
    state = pointerMove(state, 1, { x: 30, y: 10 });
    expect(state.moved).toBe(true);
  });

  test("released after moving: the closing click is swallowed, and the graph is no longer active", () => {
    let state = pointerDown(idleGesture(), 1, { x: 10, y: 10 }, { type: "point", index: 0 });
    state = pointerMove(state, 1, { x: 40, y: 10 });
    state = pointerUp(state, 1);
    expect(state.swallowClick).toBe(true);
    expect(isActive(state)).toBe(false);
  });

  test("released without moving more than the threshold: the click is not swallowed — it is a press", () => {
    let state = pointerDown(idleGesture(), 1, { x: 10, y: 10 }, { type: "point", index: 0 });
    state = pointerMove(state, 1, { x: 12, y: 11 });
    state = pointerUp(state, 1);
    expect(state.swallowClick).toBe(false);
  });
});

describe("a drag of the background (AC-3)", () => {
  test("one pointer down off any point reports a pan", () => {
    const state = pointerDown(idleGesture(), 1, { x: 10, y: 10 }, { type: "background" });
    expect(state.kind).toBe("pan");
  });
});

describe("a pinch (AC-3)", () => {
  test("a second pointer down turns the gesture into a pinch", () => {
    let state = pointerDown(idleGesture(), 1, { x: 10, y: 10 }, { type: "background" });
    state = pointerDown(state, 2, { x: 50, y: 50 }, { type: "background" });
    expect(state.kind).toBe("pinch");
    expect(state.pointers.size).toBe(2);
  });

  test("lifting one of the two pointers leaves the graph active, as a pan", () => {
    let state = pointerDown(idleGesture(), 1, { x: 10, y: 10 }, { type: "background" });
    state = pointerDown(state, 2, { x: 50, y: 50 }, { type: "background" });
    state = pointerUp(state, 1);
    expect(isActive(state)).toBe(true);
    expect(state.kind).toBe("pan");
  });
});

describe("active from the first pointer down to the last up or cancelled (AC-3)", () => {
  test("down makes it active, up makes it idle again", () => {
    let state = idleGesture();
    expect(isActive(state)).toBe(false);
    state = pointerDown(state, 1, { x: 0, y: 0 }, { type: "background" });
    expect(isActive(state)).toBe(true);
    state = pointerUp(state, 1);
    expect(isActive(state)).toBe(false);
  });

  test("a cancel clears every pointer, with nothing left to swallow", () => {
    const dragging = pointerMove(pointerDown(idleGesture(), 1, { x: 0, y: 0 }, { type: "point", index: 0 }), 1, { x: 40, y: 0 });
    expect(isActive(dragging)).toBe(true);
    const state = pointerCancel();
    expect(isActive(state)).toBe(false);
    expect(state.swallowClick).toBe(false);
  });
});
