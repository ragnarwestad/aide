// The pan/zoom/pinch arithmetic (AC-3): a pan moves everything by the same
// amount, a zoom keeps the point under its centre fixed, a pinch is the
// same zoom by the fingers' own ratio, and the frame's centre never leaves
// the visible box.

import { describe, expect, test } from "bun:test";
import { keepInSight, MAX_SCALE, MIN_SCALE, panBy, pinch, toWorld, zoomAt, type View } from "../../src/wiki-graph/view.ts";

const START: View = { x: 0, y: 0, scale: 1 };

describe("panBy (AC-3)", () => {
  test("moves the view by exactly the screen-space amount", () => {
    expect(panBy(START, 15, -8)).toEqual({ x: 15, y: -8, scale: 1 });
  });
});

describe("zoomAt (AC-3)", () => {
  test("the world point under the screen point stays under it", () => {
    const before = toWorld(START, 100, 60);
    const after = zoomAt(START, 100, 60, 2);
    expect(toWorld(after, 100, 60)).toEqual(before);
    expect(after.scale).toBe(2);
  });

  test("the scale never leaves 0.5 to 4, and the anchor still holds once clamped", () => {
    const before = toWorld(START, 40, 20);
    const zoomedOut = zoomAt(START, 40, 20, 0.1);
    expect(zoomedOut.scale).toBe(MIN_SCALE);
    expect(toWorld(zoomedOut, 40, 20)).toEqual(before);

    const zoomedIn = zoomAt(START, 40, 20, 100);
    expect(zoomedIn.scale).toBe(MAX_SCALE);
    expect(toWorld(zoomedIn, 40, 20)).toEqual(before);
  });
});

describe("pinch (AC-3)", () => {
  test("scales by the ratio of the fingers' distances, about their midpoint", () => {
    const start = { x: 0, y: 0, scale: 2 };
    const beforeStart = { x: 100, y: 100 };
    const beforeDist = 40;
    const afterDist = 80;
    const ratio = afterDist / beforeDist;
    const before = toWorld(start, beforeStart.x, beforeStart.y);
    const after = pinch(start, beforeStart.x, beforeStart.y, ratio);
    expect(after.scale).toBe(4);
    expect(toWorld(after, beforeStart.x, beforeStart.y)).toEqual(before);
  });
});

describe("keepInSight (AC-3)", () => {
  const box = { width: 300, height: 200 };

  test("leaves a view alone when the frame's centre is already inside the box", () => {
    const view: View = { x: 0, y: 0, scale: 1 };
    expect(keepInSight(view, box, 300, 200)).toEqual(view);
  });

  test("pulls the view back so the frame's centre lands back inside the box", () => {
    const view: View = { x: -1000, y: -1000, scale: 1 };
    const kept = keepInSight(view, box, 300, 200);
    const centerX = kept.x + 150 * kept.scale;
    const centerY = kept.y + 100 * kept.scale;
    expect(centerX).toBeGreaterThanOrEqual(0);
    expect(centerX).toBeLessThanOrEqual(box.width);
    expect(centerY).toBeGreaterThanOrEqual(0);
    expect(centerY).toBeLessThanOrEqual(box.height);
  });
});
