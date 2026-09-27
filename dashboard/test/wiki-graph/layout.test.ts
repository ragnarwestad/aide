// The layout settles linked points near each other and keeps every point
// clear of the next (AC-4), and picks which side of a point its name sits
// on (the recommended solution's decision 6).

import { describe, expect, test } from "bun:test";
import {
  declutterLabels, labelSide, labelWidth, LABEL_GAP, LABEL_HALF_HEIGHT, MIN_DISTANCE, settle, startPositions, tick, type Point,
} from "../../src/wiki-graph/layout.ts";
import type { WikiGraphPair } from "../../src/wiki-graph/links.ts";

const WIDTH = 720;
const HEIGHT = 480;

/** The box a label's own rendered text would occupy, the same way the
 *  render and the decluttering pass both place it: `LABEL_GAP` off the
 *  point on whichever side `labelSide` picks, `labelWidth(title)` wide,
 *  `LABEL_HALF_HEIGHT` above and below the point's own y (AC-7). Kept
 *  local to the test, the same way `meanDistance`/`allPairs` above are —
 *  the test proves the OUTCOME, not a shared implementation. */
function labelBox(p: Point, title: string, width: number): { x0: number; x1: number; y0: number; y1: number } {
  const side = labelSide(p, width);
  const w = labelWidth(title);
  const [x0, x1] = side === "start" ? [p.x + LABEL_GAP, p.x + LABEL_GAP + w] : [p.x - LABEL_GAP - w, p.x - LABEL_GAP];
  return { x0, x1, y0: p.y - LABEL_HALF_HEIGHT, y1: p.y + LABEL_HALF_HEIGHT };
}

function boxesOverlap(a: ReturnType<typeof labelBox>, b: ReturnType<typeof labelBox>): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

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

describe("declutterLabels (AC-7)", () => {
  test("two points close enough to satisfy MIN_DISTANCE but whose long-title labels would overlap end up with clear label boxes", () => {
    // Both left of the middle (same label side), 25px apart vertically —
    // past MIN_DISTANCE (20) but well inside their own label height
    // (2 * LABEL_HALF_HEIGHT) once both titles are long.
    const points: Point[] = [{ x: 100, y: 200 }, { x: 100, y: 225 }];
    const titles = ["Translations and error sentences", "How this wiki is organised"];
    const decluttered = declutterLabels(points, titles, WIDTH, HEIGHT);
    const boxes = decluttered.map((p, i) => labelBox(p, titles[i]!, WIDTH));
    expect(boxesOverlap(boxes[0]!, boxes[1]!)).toBe(false);
  });

  test("a point settled hard against the top or bottom edge ends up with its whole label box inside the frame", () => {
    const points: Point[] = [{ x: 360, y: 1 }, { x: 360, y: HEIGHT - 1 }];
    const titles = ["Translations and error sentences", "How this wiki is organised"];
    const decluttered = declutterLabels(points, titles, WIDTH, HEIGHT);
    for (let i = 0; i < decluttered.length; i++) {
      const box = labelBox(decluttered[i]!, titles[i]!, WIDTH);
      expect(box.x0).toBeGreaterThanOrEqual(0);
      expect(box.x1).toBeLessThanOrEqual(WIDTH);
      expect(box.y0).toBeGreaterThanOrEqual(0);
      expect(box.y1).toBeLessThanOrEqual(HEIGHT);
    }
  });

  test("the size of this project's own wiki (28 points, mixed title lengths) declutters with no two label boxes overlapping, at a desktop and a phone width (AC-7, AC-9)", () => {
    const { n, pairs } = bigFixture();
    const titles = Array.from({ length: n }, (_, i) =>
      ["Wiki", "Wiki graph", "How this wiki is organised", "Translations and error sentences", "Projects page"][i % 5]!);
    for (const [w, h] of [[WIDTH, HEIGHT], [328, HEIGHT]] as const) {
      const settled = settle(startPositions(n, w, h), pairs, w, h);
      const decluttered = declutterLabels(settled, titles, w, h);
      const boxes = decluttered.map((p, i) => labelBox(p, titles[i]!, w));
      for (let i = 0; i < n; i++) {
        expect(boxes[i]!.x0).toBeGreaterThanOrEqual(0);
        expect(boxes[i]!.x1).toBeLessThanOrEqual(w);
        expect(boxes[i]!.y0).toBeGreaterThanOrEqual(0);
        expect(boxes[i]!.y1).toBeLessThanOrEqual(h);
        for (let j = i + 1; j < n; j++) expect(boxesOverlap(boxes[i]!, boxes[j]!)).toBe(false);
      }
    }
  });

  test("decluttering the same input twice gives the same positions", () => {
    const { n, pairs } = bigFixture();
    const titles = Array.from({ length: n }, (_, i) => `Page number ${i} with a somewhat long title`);
    const settled = settle(startPositions(n, WIDTH, HEIGHT), pairs, WIDTH, HEIGHT);
    const once = declutterLabels(settled, titles, WIDTH, HEIGHT);
    const twice = declutterLabels(settled, titles, WIDTH, HEIGHT);
    expect(once).toEqual(twice);
  });
});

describe("labelWidth", () => {
  test("a longer title is wider, and it is deterministic", () => {
    expect(labelWidth("Wiki")).toBeGreaterThan(0);
    expect(labelWidth("Translations and error sentences")).toBeGreaterThan(labelWidth("Wiki"));
    expect(labelWidth("Wiki")).toBe(labelWidth("Wiki"));
  });
});
