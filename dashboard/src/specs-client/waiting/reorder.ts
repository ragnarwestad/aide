export function bindPointerMoves(list: HTMLElement, moved: () => void): void {
  let drag: { row: HTMLElement; pointer: number; handle: HTMLElement; x: number; y: number; active: boolean; before: Element[] } | undefined;
  list.addEventListener("pointerdown", event => {
    const handle = (event.target as Element).closest<HTMLElement>("[data-waiting-drag]");
    const row = handle?.closest<HTMLElement>("[data-waiting-id]");
    if (!handle || !row || event.button !== 0) return;
    drag = { row, pointer: event.pointerId, handle: handle!, x: event.clientX, y: event.clientY, active: false, before: [...list.children] };
    event.preventDefault();
  });
  list.addEventListener("pointermove", event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      drag.active = true; drag.handle.setPointerCapture(event.pointerId);
    }
    for (const sibling of list.querySelectorAll<HTMLElement>("[data-waiting-id]")) {
      if (sibling === drag.row) continue;
      const bounds = sibling.getBoundingClientRect();
      if (event.clientY >= bounds.top && event.clientY <= bounds.bottom) {
        list.insertBefore(drag.row, event.clientY < bounds.top + bounds.height / 2 ? sibling : sibling.nextSibling);
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
      const current = [...list.children];
      list.append(...drag.before.filter(row => row.parentElement === list), ...current.filter(row => !drag!.before.includes(row)));
    }
    drag = undefined;
    moved();
  });
}
