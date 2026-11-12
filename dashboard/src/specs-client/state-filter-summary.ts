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
