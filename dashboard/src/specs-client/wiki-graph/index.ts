// Makes the graph the server drew live: reads its points and pairs back
// out of the markup, settles it again at the box's own real size, and adds
// drag, pan, zoom and pinch over pointer events.
//
// No pointer capture at the press: a captured pointer sends its closing
// `click` to the CAPTURING element, so the press on a point would never
// reach its own link. Instead every `pointermove`/`pointerup`/`pointercancel`
// while a pointer is down is heard on `window`, and the click that follows a
// drag is swallowed by hand (`gesture.ts`'s own `swallowClick`).

import { settle, startPositions, type Point } from "../../wiki-graph/layout.ts";
import type { WikiGraphPair } from "../../wiki-graph/links.ts";
import { keepInSight, panBy, pinch as pinchZoom, zoomAt, type View } from "../../wiki-graph/view.ts";
import {
  idleGesture, isActive, pointerCancel, pointerDown, pointerMove, pointerUp, type GestureState, type GestureTarget,
} from "./gesture.ts";

const ZOOM_STEP = 1.1;
/** The same offset the server draws a name at (`wiki-graph.ts`'s own `LABEL_GAP`). */
const LABEL_GAP = 9;

interface NodeEl {
  a: SVGAElement;
  circle: SVGCircleElement;
  text: SVGTextElement;
}
interface EdgeEl {
  line: SVGLineElement;
  a: number;
  b: number;
}

interface Bound {
  svg: SVGSVGElement;
  viewport: SVGGElement;
  nodes: NodeEl[];
  edges: EdgeEl[];
  pairs: WikiGraphPair[];
  positions: Point[];
  width: number;
  height: number;
  view: View;
  gesture: GestureState;
  /** The screen point the pointer was at last, in svg-local coordinates —
   *  what a drag or a pan's next move is measured from. */
  lastPoint: { x: number; y: number };
  /** The two pointers' own distance at the last pinch move, for the ratio
   *  the next one scales by. */
  lastPinchDistance?: number;
}

const bound = new WeakMap<SVGSVGElement, Bound>();

function readNodes(svg: SVGSVGElement): NodeEl[] {
  return [...svg.querySelectorAll<SVGAElement>("a.wikinode")].map((a) => ({
    a,
    circle: a.querySelector("circle")!,
    text: a.querySelector("text")!,
  }));
}

function readEdges(svg: SVGSVGElement): EdgeEl[] {
  return [...svg.querySelectorAll<SVGLineElement>("line.wikiedge")].map((line) => ({
    line,
    a: Number(line.dataset.a),
    b: Number(line.dataset.b),
  }));
}

function applyPositions(state: Bound): void {
  state.nodes.forEach(({ circle, text }, i) => {
    const p = state.positions[i]!;
    circle.setAttribute("cx", String(p.x));
    circle.setAttribute("cy", String(p.y));
    const side = text.getAttribute("text-anchor") === "end" ? -LABEL_GAP : LABEL_GAP;
    text.setAttribute("x", String(p.x + side));
    text.setAttribute("y", String(p.y));
  });
  for (const { line, a, b } of state.edges) {
    const pa = state.positions[a]!;
    const pb = state.positions[b]!;
    line.setAttribute("x1", String(pa.x));
    line.setAttribute("y1", String(pa.y));
    line.setAttribute("x2", String(pb.x));
    line.setAttribute("y2", String(pb.y));
  }
}

function applyView(state: Bound): void {
  state.viewport.setAttribute("transform", `translate(${state.view.x} ${state.view.y}) scale(${state.view.scale})`);
}

/** Re-lay the graph out at the box's own real size — the first draw
 *  measured on load, and again on a resize while nothing is being dragged. */
function resettle(state: Bound): void {
  const rect = state.svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  state.width = rect.width;
  state.height = rect.height;
  state.svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  state.positions = settle(startPositions(state.nodes.length, rect.width, rect.height), state.pairs, rect.width, rect.height);
  state.view = { x: 0, y: 0, scale: 1 };
  applyPositions(state);
  applyView(state);
}

const relativePoint = (state: Bound, event: PointerEvent | WheelEvent): { x: number; y: number } => {
  const rect = state.svg.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

function targetOf(state: Bound, event: PointerEvent): GestureTarget {
  const target = event.target as Element | null;
  const node = target?.closest?.("a.wikinode");
  const index = node ? state.nodes.findIndex((n) => n.a === node) : -1;
  return index >= 0 ? { type: "point", index } : { type: "background" };
}

function pinchGeometry(state: Bound): { midX: number; midY: number; dist: number } | undefined {
  const points = [...state.gesture.pointers.values()];
  if (points.length < 2) return undefined;
  const [p, q] = points;
  return { midX: (p!.x + q!.x) / 2, midY: (p!.y + q!.y) / 2, dist: Math.hypot(p!.x - q!.x, p!.y - q!.y) };
}

function onMove(state: Bound, event: PointerEvent): void {
  const point = relativePoint(state, event);
  const wasActive = isActive(state.gesture);
  state.gesture = pointerMove(state.gesture, event.pointerId, point);
  if (!wasActive) return;

  if (state.gesture.kind === "pinch") {
    const geometry = pinchGeometry(state);
    if (geometry) {
      if (state.lastPinchDistance) {
        const ratio = geometry.dist / state.lastPinchDistance;
        state.view = keepInSight(pinchZoom(state.view, geometry.midX, geometry.midY, ratio), box(state), state.width, state.height);
        applyView(state);
      }
      state.lastPinchDistance = geometry.dist;
    }
    return;
  }

  const dx = point.x - state.lastPoint.x;
  const dy = point.y - state.lastPoint.y;
  state.lastPoint = point;
  if (state.gesture.kind === "pan") {
    state.view = keepInSight(panBy(state.view, dx, dy), box(state), state.width, state.height);
    applyView(state);
  } else if (state.gesture.kind === "drag" && state.gesture.target?.type === "point") {
    const i = state.gesture.target.index;
    state.positions[i] = { x: state.positions[i]!.x + dx / state.view.scale, y: state.positions[i]!.y + dy / state.view.scale };
    applyPositions(state);
  }
}

function endGesture(state: BoundWithWindow, next: GestureState): void {
  state.gesture = next;
  if (isActive(state.gesture)) return;
  state.svg.removeAttribute("data-active");
  state.lastPinchDistance = undefined;
  window.removeEventListener("pointermove", state.onWindowMove);
  window.removeEventListener("pointerup", state.onWindowUp);
  window.removeEventListener("pointercancel", state.onWindowCancel);
}

const box = (state: Bound): { width: number; height: number } => ({ width: state.width, height: state.height });

interface BoundWithWindow extends Bound {
  onWindowMove: (e: PointerEvent) => void;
  onWindowUp: (e: PointerEvent) => void;
  onWindowCancel: (e: PointerEvent) => void;
}

export function bindWikiGraph(svg: SVGSVGElement): void {
  if (bound.has(svg)) return;
  const viewport = svg.querySelector<SVGGElement>("[data-viewport]");
  if (!viewport) return;

  const edges = readEdges(svg);
  const state: BoundWithWindow = {
    svg,
    viewport,
    nodes: readNodes(svg),
    edges,
    pairs: edges.map(({ a, b }) => ({ a, b })),
    positions: [],
    width: 0,
    height: 0,
    view: { x: 0, y: 0, scale: 1 },
    gesture: idleGesture(),
    lastPoint: { x: 0, y: 0 },
    onWindowMove: () => {},
    onWindowUp: () => {},
    onWindowCancel: () => {},
  };
  bound.set(svg, state);
  resettle(state);

  state.onWindowMove = (event: PointerEvent) => onMove(state, event);
  state.onWindowUp = (event: PointerEvent) => endGesture(state, pointerUp(state.gesture, event.pointerId));
  state.onWindowCancel = () => endGesture(state, pointerCancel());

  svg.addEventListener("dragstart", (event) => event.preventDefault());
  svg.addEventListener("pointerdown", (event) => {
    const wasActive = isActive(state.gesture);
    state.lastPoint = relativePoint(state, event);
    state.gesture = pointerDown(state.gesture, event.pointerId, state.lastPoint, targetOf(state, event));
    if (!wasActive) {
      svg.setAttribute("data-active", "");
      window.addEventListener("pointermove", state.onWindowMove);
      window.addEventListener("pointerup", state.onWindowUp);
      window.addEventListener("pointercancel", state.onWindowCancel);
    }
  });
  svg.addEventListener("click", (event) => {
    if (!state.gesture.swallowClick) return;
    event.preventDefault();
    state.gesture = { ...state.gesture, swallowClick: false };
  });
  svg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const point = relativePoint(state, event);
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      state.view = keepInSight(zoomAt(state.view, point.x, point.y, factor), box(state), state.width, state.height);
      applyView(state);
    },
    { passive: false },
  );

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!isActive(state.gesture)) resettle(state);
    }, 150);
  });
}

/** Every graph on the page — there is at most one on the Wiki tab, but
 *  nothing here assumes it. */
export function bindWikiGraphs(root: ParentNode): void {
  for (const svg of root.querySelectorAll<SVGSVGElement>("svg[data-wikigraph]")) bindWikiGraph(svg);
}
