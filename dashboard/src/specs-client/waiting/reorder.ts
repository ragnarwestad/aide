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
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      drag.active = true; drag.handle.setPointerCapture(event.pointerId);
    }
    for (const sibling of list.querySelectorAll<HTMLElement>("[data-waiting-id]")) {
      if (sibling === drag.row) continue;
      const bounds = sibling.getBoundingClientRect();
      if (event.clientY >= bounds.top && event.clientY <= bounds.bottom) {
        const before = event.clientY < bounds.top + bounds.height / 2 ? sibling : sibling.nextElementSibling;
        const rows = [...list.children].filter(row => row !== drag!.row);
        rows.splice(before ? rows.indexOf(before) : rows.length, 0, drag.row);
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
      const current = [...list.children];
      list.append(...drag.before.filter(row => row.parentElement === list), ...current.filter(row => !drag!.before.includes(row)));
    }
    drag = undefined;
    moved();
  });
}
