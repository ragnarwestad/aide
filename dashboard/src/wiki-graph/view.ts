// Pan, zoom and pinch, as a transform applied to the graph's own
// `<g data-viewport>` — never as a change to the settled layout itself,
// which stays exactly as the server (or a resize) laid it out.

export interface View {
  /** Where the layout's own (0,0) lands on the screen. */
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 4;

const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** A screen point translated to where it falls in the layout's own
 *  coordinates, given the view now showing it. */
export const toWorld = (view: View, sx: number, sy: number): { x: number; y: number } => ({
  x: (sx - view.x) / view.scale,
  y: (sy - view.y) / view.scale,
});

/** Move the view by a screen-space amount — a drag of the empty
 *  background moves everything by exactly the pointer's own motion. */
export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/** Zoom by `factor` about the screen point `(sx, sy)`: the layout point
 *  that was under it stays under it, even where the scale clamps short of
 *  the requested factor. */
export function zoomAt(view: View, sx: number, sy: number, factor: number): View {
  const scale = clampScale(view.scale * factor);
  const ratio = scale / view.scale;
  return { scale, x: sx - (sx - view.x) * ratio, y: sy - (sy - view.y) * ratio };
}

/** Two fingers moving apart or together: the same zoom, about their own
 *  midpoint, by the ratio their distance changed by. */
export function pinch(view: View, midX: number, midY: number, ratio: number): View {
  return zoomAt(view, midX, midY, ratio);
}

/** After any pan or zoom, the layout's own centre stays somewhere inside
 *  the box the graph is drawn in — never panned or zoomed away entirely. */
export function keepInSight(view: View, box: { width: number; height: number }, worldWidth: number, worldHeight: number): View {
  const centerX = view.x + (worldWidth / 2) * view.scale;
  const centerY = view.y + (worldHeight / 2) * view.scale;
  let { x, y } = view;
  if (centerX < 0) x -= centerX;
  else if (centerX > box.width) x -= centerX - box.width;
  if (centerY < 0) y -= centerY;
  else if (centerY > box.height) y -= centerY - box.height;
  return { ...view, x, y };
}
