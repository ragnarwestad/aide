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

/** How far a label's text starts from its own point — the render
 *  (`wiki-graph.ts`) and the browser script (`specs-client/wiki-graph/index.ts`)
 *  both import this rather than keeping their own copy, so a name's box here
 *  is the box actually drawn. */
export const LABEL_GAP = 9;

/** Half a label's own line height: an ascender or a descender on a 12px
 *  sans body (`--fs-s`) never clips past this from the point's own y — a
 *  hair over the font's own metrics (a real browser's rendered `<text>`
 *  box runs right up against a tighter number), so the margin holds with room to
 *  spare rather than by a fraction of a pixel. */
export const LABEL_HALF_HEIGHT = 12;

/** An estimate of a title's rendered width — wider than `--fs-s` actually
 *  renders on purpose (decision in 3-solution.md): the estimate only has to
 *  be conservative, and a real browser's own layout (AC-7's own test)
 *  measures what was actually drawn, not this number. */
const CHAR_WIDTH = 7;
export function labelWidth(title: string): number {
  return title.length * CHAR_WIDTH;
}

/** No two points' label boxes settle closer than this many passes'
 *  worth of pushing apart — `declutterLabels`'s own cap, the same role
 *  `SETTLE_CAP` plays for `settle()`. */
const LABEL_PASSES = 60;

interface LabelBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function labelBox(p: Point, title: string, width: number): LabelBox {
  const side = labelSide(p, width);
  const w = labelWidth(title);
  const [x0, x1] = side === "start" ? [p.x + LABEL_GAP, p.x + LABEL_GAP + w] : [p.x - LABEL_GAP - w, p.x - LABEL_GAP];
  return { x0, x1, y0: p.y - LABEL_HALF_HEIGHT, y1: p.y + LABEL_HALF_HEIGHT };
}

function boxOverlap(a: LabelBox, b: LabelBox): { dx: number; dy: number } | undefined {
  const dx = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const dy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return dx > 0 && dy > 0 ? { dx, dy } : undefined;
}

/** A point's own label never crosses the frame's edge, and never crosses
 *  the vertical middle — crossing it would flip `labelSide`'s own answer
 *  and could see-saw the point back and forth across passes. Kept inside
 *  whichever half the point already sits in. */
function clampToLabelFrame(p: Point, title: string, width: number, height: number): Point {
  const side = labelSide(p, width);
  const w = labelWidth(title);
  const mid = width / 2;
  const lo = side === "start" ? MARGIN : Math.max(MARGIN + w + LABEL_GAP, mid);
  const hi = side === "start" ? Math.min(width - MARGIN - w - LABEL_GAP, mid) : width - MARGIN;
  return {
    x: Math.min(Math.max(lo, hi), Math.max(Math.min(lo, hi), p.x)),
    y: Math.min(height - LABEL_HALF_HEIGHT, Math.max(LABEL_HALF_HEIGHT, p.y)),
  };
}

/** After `settle()`: push apart any two points whose LABEL boxes — not
 *  just their circles — still overlap, and keep every label's own box,
 *  not only the point, inside the frame (AC-7, AC-9). Runs strictly after
 *  `settle()` returns and never re-invokes `tick()`, so it cannot fight
 *  that pass's own forces: a separate, capped pass over already-settled
 *  points, the same relationship `separate()` already has inside one
 *  `tick()` call. */
export function declutterLabels(points: readonly Point[], titles: readonly string[], width: number, height: number): Point[] {
  let current = points.map((p) => ({ ...p }));
  for (let pass = 0; pass < LABEL_PASSES; pass++) {
    let moved = false;
    const boxes = current.map((p, i) => labelBox(p, titles[i]!, width));
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const hit = boxOverlap(boxes[i]!, boxes[j]!);
        if (!hit) continue;
        moved = true;
        // Separate along whichever axis has the smaller overlap — the
        // ordinary AABB push-apart heuristic, so a small nudge resolves
        // it rather than one axis always winning.
        if (hit.dy <= hit.dx) {
          const push = hit.dy / 2 + 1;
          const down = current[i]!.y <= current[j]!.y;
          current[i]!.y += down ? -push : push;
          current[j]!.y += down ? push : -push;
        } else {
          const push = hit.dx / 2 + 1;
          const left = current[i]!.x <= current[j]!.x;
          current[i]!.x += left ? -push : push;
          current[j]!.x += left ? push : -push;
        }
        current[i] = clampToLabelFrame(current[i]!, titles[i]!, width, height);
        current[j] = clampToLabelFrame(current[j]!, titles[j]!, width, height);
        boxes[i] = labelBox(current[i]!, titles[i]!, width);
        boxes[j] = labelBox(current[j]!, titles[j]!, width);
      }
    }
    if (!moved) break;
  }
  return current.map((p, i) => clampToLabelFrame(p, titles[i]!, width, height));
}
