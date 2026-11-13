/** Show the selected names when they fit the width reserved by the widest option. */
export function fitStateFilterSummary(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>(".menu.state .menuwidth")) {
    const names = box.querySelector<HTMLElement>("[data-state-names]");
    const count = box.querySelector<HTMLElement>("[data-state-count]");
    if (!names || !count) continue;
    names.hidden = false;
    count.hidden = true;
    names.style.width = "max-content";
    const fits = names.getBoundingClientRect().width <= box.clientWidth;
    names.style.width = "";
    if (!fits) {
      names.hidden = true;
      count.hidden = false;
    }
  }
}

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
