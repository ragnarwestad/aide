/** Note which filter menu is open, and the option that has focus in it, so
 *  the redraw a tick causes can put both back: the menu stays open for the
 *  next tick, and closes on Escape or a click outside it (`menu-script.ts`).
 *  A menu the reader closes while the redraw is under way stays closed. */
export function holdOpenFilterMenu(root: ParentNode): () => void {
  const menu = root.querySelector<HTMLDetailsElement>("details.menu[data-filter][open]");
  if (!menu) return () => {};
  const filter = menu.dataset.filter;
  const options = Array.from(menu.querySelectorAll(".menupanel a"));
  const focused = options.indexOf(document.activeElement as Element);
  // The redraw may replace the menu with a new one, so a close is heard
  // on the root, for whichever copy of this menu the reader closed.
  let closed = false;
  const heard = (event: Event): void => {
    const target = event.target as HTMLDetailsElement;
    if (target.matches?.(`details.menu[data-filter="${filter}"]`) && !target.open) closed = true;
  };
  root.addEventListener("toggle", heard, true);
  return () => {
    root.removeEventListener("toggle", heard, true);
    const again = root.querySelector<HTMLDetailsElement>(`details.menu[data-filter="${filter}"]`);
    if (!again || closed || (again === menu && !menu.open)) return;
    again.open = true;
    if (focused >= 0) again.querySelectorAll<HTMLElement>(".menupanel a")[focused]?.focus();
  };
}
