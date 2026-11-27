/** A press on the handle becomes a drag once the pointer has travelled this far. */
export function dragStarted(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= 6;
}

/** Which side of a row the pointer is over: before it in its top half,
 *  after it in its bottom half, and neither outside the row. */
export function dropSide(y: number, top: number, bottom: number): "before" | "after" | undefined {
  if (y < top || y > bottom) return undefined;
  return y < top + (bottom - top) / 2 ? "before" : "after";
}

/** The list with `dragged` taken out and put back in front of `before`, or last without one. */
export function dropOrder<T>(items: readonly T[], dragged: T, before: T | null): T[] {
  const rows = items.filter(row => row !== dragged);
  rows.splice(before ? rows.indexOf(before) : rows.length, 0, dragged);
  return rows;
}

/** A cancelled drag's list: the rows it started with, in their old order,
 *  then any row that joined the list during the drag. */
export function restoredOrder<T>(before: readonly T[], current: readonly T[]): T[] {
  return [...before.filter(row => current.includes(row)), ...current.filter(row => !before.includes(row))];
}

export function bindPointerMoves(list: HTMLElement, moved: () => void, allowed: (ids: string[]) => boolean, target: () => string): void {
  let drag: { row: HTMLElement; pointer: number; handle: HTMLElement; x: number; y: number; active: boolean; before: Element[] } | undefined;
  list.addEventListener("pointerdown", event => {
    const handle = (event.target as Element).closest<HTMLElement>("[data-waiting-drag]");
    const row = handle?.closest<HTMLElement>("[data-waiting-id]");
    if (!handle || !row || row.dataset.waitingId !== target() || (handle as HTMLButtonElement).disabled || event.button !== 0) return;
    drag = { row, pointer: event.pointerId, handle: handle!, x: event.clientX, y: event.clientY, active: false, before: [...list.children] };
    event.preventDefault();
  });
  list.addEventListener("pointermove", event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    if (!drag.active) {
      if (!dragStarted(event.clientX - drag.x, event.clientY - drag.y)) return;
      drag.active = true; drag.handle.setPointerCapture(event.pointerId);
    }
    for (const sibling of list.querySelectorAll<HTMLElement>("[data-waiting-id]")) {
      if (sibling === drag.row) continue;
      const bounds = sibling.getBoundingClientRect();
      const side = dropSide(event.clientY, bounds.top, bounds.bottom);
      if (side) {
        const before = side === "before" ? sibling : sibling.nextElementSibling;
        const rows = dropOrder<Element>([...list.children], drag.row, before);
        if (!allowed(rows.map(row => (row as HTMLElement).dataset.waitingId!))) break;
        list.insertBefore(drag.row, before);
        moved();
        break;
      }
    }
    const box = list.getBoundingClientRect();
    if (event.clientY < box.top + 40) list.scrollBy(0, -15);
    if (event.clientY > box.bottom - 40) list.scrollBy(0, 15);
  });
  list.addEventListener("pointerup", () => { drag = undefined; moved(); });
  list.addEventListener("pointercancel", () => {
    if (drag) {
      list.append(...restoredOrder(drag.before, [...list.children]));
    }
    drag = undefined;
    moved();
  });
}
