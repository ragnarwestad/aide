// What a sequence of pointer events means: a drag of one point, a pan of
// the background, or a pinch once a second pointer joins — and whether the
// graph is "active" (so the tab's own reload waits) and whether the click
// that follows must be swallowed (so a drag never also opens the link it
// started on). Pure: no DOM here, so the rules are pinned without one.

export type GestureTarget = { type: "point"; index: number } | { type: "background" };
export type GestureKind = "idle" | "drag" | "pan" | "pinch";

export interface PointerPoint {
  x: number;
  y: number;
}

export interface GestureState {
  kind: GestureKind;
  /** Every pointer currently down, by its own id. */
  pointers: ReadonlyMap<number, PointerPoint>;
  target?: GestureTarget;
  /** Where the first pointer went down — what "moved past the press
   *  threshold" is measured from. */
  start: PointerPoint;
  /** Whether the first pointer has moved past the press threshold since. */
  moved: boolean;
  /** Whether the click following the pointer sequence just closed must be
   *  swallowed, so a drag does not also open the link it started on. */
  swallowClick: boolean;
}

/** Below this many pixels of movement, a press is still a press, not a
 *  drag — decision 5 of the spec's solution. */
export const PRESS_THRESHOLD = 6;

export const idleGesture = (): GestureState => ({
  kind: "idle",
  pointers: new Map(),
  start: { x: 0, y: 0 },
  moved: false,
  swallowClick: false,
});

/** The graph is "active" from the first pointer going down until the last
 *  one is released or cancelled — the tab's own reload waits while this is
 *  true. */
export const isActive = (state: GestureState): boolean => state.pointers.size > 0;

/** A pointer going down: the first one decides a drag or a pan by what it
 *  landed on; a second turns whichever of those was under way into a
 *  pinch. */
export function pointerDown(state: GestureState, id: number, point: PointerPoint, target: GestureTarget): GestureState {
  const pointers = new Map(state.pointers);
  pointers.set(id, point);
  if (pointers.size === 1) {
    return { kind: target.type === "point" ? "drag" : "pan", pointers, target, start: point, moved: false, swallowClick: false };
  }
  return { ...state, kind: "pinch", pointers };
}

/** A pointer moving: past the press threshold, the sequence counts as
 *  having moved — which decides whether the closing click is swallowed. */
export function pointerMove(state: GestureState, id: number, point: PointerPoint): GestureState {
  if (!state.pointers.has(id)) return state;
  const pointers = new Map(state.pointers);
  pointers.set(id, point);
  const moved = state.moved || Math.hypot(point.x - state.start.x, point.y - state.start.y) > PRESS_THRESHOLD;
  return { ...state, pointers, moved };
}

/** A pointer lifted: the graph stays active while another is still down
 *  (a pinch degrading to a pan), and the closing click is only swallowed
 *  once every pointer is up after a drag that moved. */
export function pointerUp(state: GestureState, id: number): GestureState {
  const pointers = new Map(state.pointers);
  pointers.delete(id);
  if (pointers.size > 0) return { ...state, pointers, kind: "pan" };
  return { ...idleGesture(), swallowClick: state.kind === "drag" && state.moved };
}

/** A pointer cancelled: the same as every pointer lifting at once, with
 *  nothing left to swallow — there is no closing click after a cancel. */
export function pointerCancel(): GestureState {
  return idleGesture();
}
