import { SPEC_HEAD_CLASS } from "../../page-contract.ts";

const expanded = new Map<string, boolean>();

export function syncSpecGroups(root: ParentNode): void {
  for (const head of root.querySelectorAll<HTMLElement>("tr[data-spec-group]")) {
    const key = head.getAttribute("data-spec-group")!;
    const members: HTMLElement[] = [];
    for (let row = head.nextElementSibling as HTMLElement | null; row; row = row.nextElementSibling as HTMLElement | null) {
      if (row.hasAttribute("data-spec-group") ||
        (row.classList.contains(SPEC_HEAD_CLASS) && row.getAttribute("data-spec-group-member") !== key)) break;
      members.push(row);
    }
    const open = expanded.get(key) ?? members.some((row) => row.hasAttribute("data-spec-detail"));
    const button = head.querySelector("[data-group-toggle]");
    button?.setAttribute("aria-expanded", String(open));
    button?.classList.toggle("shut", !open);
    for (const row of members) row.hidden = !open;
  }
}

export function toggleSpecGroup(event: MouseEvent): void {
  const button = (event.target as Element | null)?.closest?.("[data-group-toggle]");
  if (!button) return;
  event.preventDefault();
  expanded.set(button.getAttribute("data-group-toggle")!, button.getAttribute("aria-expanded") !== "true");
  syncSpecGroups(button.ownerDocument);
}
