// The graph's layout: where a point starts, one step of settling it near
// its linked neighbours, and which side of a point its name sits on. Pure
// arithmetic, with no randomness anywhere — the same pairs settle to the
// same positions every time, on the server and in a browser alike.

import type { WikiGraphPair } from "./links.ts";

export interface Point {
  x: number;
  y: number;
}

/** Twice the point's own radius (6, see `wiki-graph.ts`), plus a gap — no
 *  two centres settle closer than this. */
export const MIN_DISTANCE = 20;

// Repulsion falls off as 1/distance (not 1/distance²) so that it still
// competes with the pull to the centre at the range that separates one
// cluster of pages from another — a steeper fall-off left two linked
// clusters no nearer each other than two pages with no link between them.
const REPEL = 3000;
const SPRING_LENGTH = 60;
const SPRING_K = 0.05;
const CENTER_K = 0.003;
const STEP = 0.3;
const SETTLE_CAP = 300;
/** Below this, one more step would not visibly move anything — settling
 *  stops here rather than spending the rest of the cap on nothing. */
const REST_EPSILON = 0.05;
/** How far a point's centre stays from the frame's own edge. */
const MARGIN = 8;
/** Repeated within one tick: a single pass leaves a dense wiki (28 pages,
 *  spread over a phone's narrow width) still short of `MIN_DISTANCE` in
 *  places; this many passes closes that gap before the next tick's forces
 *  are computed. */
const SEPARATION_PASSES = 20;

/** A spiral round the centre, tightest at the middle — the deterministic
 *  start every layout settles from, with no two points starting on top of
 *  one another. */
export function startPositions(n: number, width: number, height: number): Point[] {
  const cx = width / 2;
  const cy = height / 2;
  const points: Point[] = [];
  for (let i = 0; i < n; i++) {
    const angle = i * 2.4;
    const radius = 8 * Math.sqrt(i);
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return points;
}

const clampToFrame = (p: Point, width: number, height: number): Point => ({
  x: Math.min(width - MARGIN, Math.max(MARGIN, p.x)),
  y: Math.min(height - MARGIN, Math.max(MARGIN, p.y)),
});

/** One pass: any two points still closer than `MIN_DISTANCE` are pushed
 *  apart along the line between them. Never lets a point leave the frame. */
function separate(points: Point[], width: number, height: number): Point[] {
  const next = points.map((p) => ({ ...p }));
  for (let i = 0; i < next.length; i++) {
    for (let j = i + 1; j < next.length; j++) {
      let dx = next[j]!.x - next[i]!.x;
      let dy = next[j]!.y - next[i]!.y;
      let dist = Math.hypot(dx, dy);
      if (dist < MIN_DISTANCE) {
        if (dist < 0.01) {
          dx = 1;
          dy = 0;
          dist = 1;
        }
        const push = (MIN_DISTANCE - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        next[i]!.x -= ux * push;
        next[i]!.y -= uy * push;
        next[j]!.x += ux * push;
        next[j]!.y += uy * push;
      }
    }
  }
  return next.map((p) => clampToFrame(p, width, height));
}

/** One step: every point repels every other, a linked pair springs toward
 *  `SPRING_LENGTH` apart, everything is pulled gently toward the centre (so
 *  a point with no pair still stays in frame), then several separation
 *  passes push apart any two points still closer than `MIN_DISTANCE`. */
export function tick(points: Point[], pairs: readonly WikiGraphPair[], width: number, height: number): Point[] {
  const n = points.length;
  const fx = new Array(n).fill(0);
  const fy = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dx = points[i]!.x - points[j]!.x;
      let dy = points[i]!.y - points[j]!.y;
      let distSq = dx * dx + dy * dy;
      if (distSq < 1) {
        dx = 1;
        dy = 0;
        distSq = 1;
      }
      const dist = Math.sqrt(distSq);
      const force = REPEL / dist;
      fx[i] += (dx / dist) * force;
      fy[i] += (dy / dist) * force;
      fx[j] -= (dx / dist) * force;
      fy[j] -= (dy / dist) * force;
    }
  }

  for (const { a, b } of pairs) {
    const dx = points[b]!.x - points[a]!.x;
    const dy = points[b]!.y - points[a]!.y;
    const dist = Math.max(0.1, Math.hypot(dx, dy));
    const force = SPRING_K * (dist - SPRING_LENGTH);
    const ux = dx / dist;
    const uy = dy / dist;
    fx[a] += ux * force;
    fy[a] += uy * force;
    fx[b] -= ux * force;
    fy[b] -= uy * force;
  }

  const cx = width / 2;
  const cy = height / 2;
  for (let i = 0; i < n; i++) {
    fx[i] += (cx - points[i]!.x) * CENTER_K;
    fy[i] += (cy - points[i]!.y) * CENTER_K;
  }

  let next = points.map((p, i) => clampToFrame({ x: p.x + fx[i] * STEP, y: p.y + fy[i] * STEP }, width, height));
  for (let pass = 0; pass < SEPARATION_PASSES; pass++) next = separate(next, width, height);
  return next;
}

/** Ticks until nothing moves more than a whisker, or `SETTLE_CAP` steps —
 *  whichever comes first, so a large wiki never runs longer than that cap. */
export function settle(points: readonly Point[], pairs: readonly WikiGraphPair[], width: number, height: number): Point[] {
  let current = points.map((p) => ({ ...p }));
  for (let step = 0; step < SETTLE_CAP; step++) {
    const next = tick(current, pairs, width, height);
    let moved = 0;
    for (let i = 0; i < next.length; i++) moved = Math.max(moved, Math.hypot(next[i]!.x - current[i]!.x, next[i]!.y - current[i]!.y));
    current = next;
    if (moved < REST_EPSILON) break;
  }
  return current;
}

export type LabelSide = "start" | "end";

/** The side of a point its name is drawn on: whichever side faces the
 *  middle of the frame, so most names stay inside the box. */
export function labelSide(point: Point, width: number): LabelSide {
  return point.x < width / 2 ? "start" : "end";
}
