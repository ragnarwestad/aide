// The layout settles linked points near each other and keeps every point
// clear of the next (AC-4), and picks which side of a point its name sits
// on (the recommended solution's decision 6).

import { describe, expect, test } from "bun:test";
import { labelSide, MIN_DISTANCE, settle, startPositions, tick, type Point } from "../../src/wiki-graph/layout.ts";
import type { WikiGraphPair } from "../../src/wiki-graph/links.ts";

const WIDTH = 720;
const HEIGHT = 480;

function meanDistance(points: Point[], pairs: { a: number; b: number }[]): number {
  const total = pairs.reduce((sum, { a, b }) => sum + Math.hypot(points[a]!.x - points[b]!.x, points[a]!.y - points[b]!.y), 0);
  return total / pairs.length;
}

function allPairs(n: number): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) out.push({ a, b });
  return out;
}

/** 28 points and 156 pairs, one point (27) with no pair — the size of this
 *  project's own wiki (2-analysis.md). */
function bigFixture(): { n: number; pairs: WikiGraphPair[] } {
  const n = 28;
  const isolated = 27;
  const pairs: WikiGraphPair[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 1; k <= 6; k++) {
      const j = (i + k) % n;
      if (j === isolated) continue;
      pairs.push({ a: i, b: j });
    }
  }
  return { n, pairs };
}

describe("startPositions", () => {
  test("no two points start on top of one another, and it is the same every time", () => {
    const a = startPositions(28, WIDTH, HEIGHT);
    const b = startPositions(28, WIDTH, HEIGHT);
    expect(a).toEqual(b);
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
      expect(Math.hypot(a[i]!.x - a[j]!.x, a[i]!.y - a[j]!.y)).toBeGreaterThan(0);
    }
  });
});

describe("settle (AC-4)", () => {
  test("two linked groups end up nearer within a group than across (AC-4)", () => {
    // Group A: 0-3 all linked to each other. Group B: 4-7 the same. One
    // link crosses between the groups.
    const groupPairs: WikiGraphPair[] = [];
    for (const base of [0, 4]) for (let a = base; a < base + 4; a++) for (let b = a + 1; b < base + 4; b++) groupPairs.push({ a, b });
    groupPairs.push({ a: 0, b: 4 });
    const start = startPositions(8, WIDTH, HEIGHT);
    const settled = settle(start, groupPairs, WIDTH, HEIGHT);
    const linkedMean = meanDistance(settled, groupPairs);
    const unlinkedPairs = allPairs(8).filter((p) => !groupPairs.some((g) => g.a === p.a && g.b === p.b));
    const unlinkedMean = meanDistance(settled, unlinkedPairs);
    expect(linkedMean).toBeLessThan(unlinkedMean);
  });

  test("28 points and 156 pairs settle with no two centres closer than the floor, everything inside the frame, and a lone point stays too (AC-4)", () => {
    const { n, pairs } = bigFixture();
    for (const [w, h] of [[WIDTH, HEIGHT], [328, HEIGHT]] as const) {
      const start = startPositions(n, w, h);
      const settled = settle(start, pairs, w, h);
      expect(settled).toHaveLength(n);
      for (let i = 0; i < n; i++) {
        expect(settled[i]!.x).toBeGreaterThanOrEqual(0);
        expect(settled[i]!.x).toBeLessThanOrEqual(w);
        expect(settled[i]!.y).toBeGreaterThanOrEqual(0);
        expect(settled[i]!.y).toBeLessThanOrEqual(h);
        for (let j = i + 1; j < n; j++) {
          expect(Math.hypot(settled[i]!.x - settled[j]!.x, settled[i]!.y - settled[j]!.y)).toBeGreaterThanOrEqual(MIN_DISTANCE - 0.5);
        }
      }
    }
  });

  test("settling the same input twice gives the same positions (AC-4)", () => {
    const { n, pairs } = bigFixture();
    const start = startPositions(n, WIDTH, HEIGHT);
    const once = settle(start, pairs, WIDTH, HEIGHT);
    const twice = settle(start, pairs, WIDTH, HEIGHT);
    expect(once).toEqual(twice);
  });

  test("tick alone never lets two points collapse onto the same point", () => {
    const start = startPositions(4, WIDTH, HEIGHT);
    const pairs: WikiGraphPair[] = [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }];
    let points = start;
    for (let i = 0; i < 50; i++) points = tick(points, pairs, WIDTH, HEIGHT);
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      expect(Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y)).toBeGreaterThanOrEqual(MIN_DISTANCE - 0.5);
    }
  });
});

describe("labelSide (decision 6)", () => {
  test("a point left of the middle faces right, and one right of it faces left", () => {
    expect(labelSide({ x: 100, y: 0 }, WIDTH)).toBe("start");
    expect(labelSide({ x: 600, y: 0 }, WIDTH)).toBe("end");
  });
});
