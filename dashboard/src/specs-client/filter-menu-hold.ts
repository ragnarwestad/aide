/** Note which filter menu is open, and the option that has focus in it, so
 *  the redraw a tick causes can put both back: the menu stays open for the
 *  next tick, and closes on Escape or a click outside it (`menu-script.ts`). */
export function holdOpenFilterMenu(root: ParentNode): () => void {
  const menu = root.querySelector<HTMLDetailsElement>("details.menu[data-filter][open]");
  if (!menu) return () => {};
  const filter = menu.dataset.filter;
  const options = Array.from(menu.querySelectorAll(".menupanel a"));
  const focused = options.indexOf(document.activeElement as Element);
  return () => {
    const again = root.querySelector<HTMLDetailsElement>(`details.menu[data-filter="${filter}"]`);
    if (!again) return;
    again.open = true;
    if (focused >= 0) again.querySelectorAll<HTMLElement>(".menupanel a")[focused]?.focus();
  };
}
