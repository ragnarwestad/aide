const expanded = new Map<string, boolean>();

/** Each group card on the page shown open or shut: the reader's own choice
 *  while the page lives, otherwise open only when a member's spec is open
 *  in it. Shut hides the group's second line and its members. */
export function syncSpecGroups(root: ParentNode): void {
  for (const group of root.querySelectorAll<HTMLElement>("tr[data-spec-group]")) {
    const key = group.getAttribute("data-spec-group")!;
    const open = expanded.get(key) ?? group.querySelector("[data-spec-detail]") !== null;
    const button = group.querySelector("[data-group-toggle]");
    button?.setAttribute("aria-expanded", String(open));
    button?.classList.toggle("shut", !open);
    for (const part of group.querySelectorAll<HTMLElement>("[data-group-body]")) part.hidden = !open;
    const action = group.querySelector<HTMLElement>("[data-group-action]");
    const state = group.querySelector<HTMLElement>("[data-group-state]");
    if (action) action.hidden = !open;
    if (state) state.hidden = open && !!action;
  }
}

export function toggleSpecGroup(event: MouseEvent): void {
  const button = (event.target as Element | null)?.closest?.("[data-group-toggle]");
  if (!button) return;
  event.preventDefault();
  expanded.set(button.getAttribute("data-group-toggle")!, button.getAttribute("aria-expanded") !== "true");
  syncSpecGroups(button.ownerDocument);
}
