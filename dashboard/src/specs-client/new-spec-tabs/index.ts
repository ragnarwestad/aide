// The New spec page's Spec and Options tabs. Both are panels of the one
// form, so a press posts what either holds; this switches them in place,
// where every other tab strip on the board loads a page and would drop
// what was typed on the other tab.

import { NEW_SPEC_FORM } from "../state.ts";

export const NEW_SPEC_TAB_STRIP = "nav[data-new-spec-tabs]";

/** The tab a strip link names, from its own `?tab=`. */
const tabOf = (link: Element): string | null =>
  new URLSearchParams((link.getAttribute("href") ?? "").split("?")[1] ?? "").get("tab");

/** Shows the panel `key` names and hides the other, and marks its tab current. */
export function showTab(form: Element, strip: Element, key: string): void {
  for (const el of form.querySelectorAll("[data-tab-panel]")) {
    (el as HTMLElement).hidden = el.getAttribute("data-tab-panel") !== key;
  }
  for (const tab of strip.querySelectorAll("a.tab")) {
    if (tabOf(tab) === key) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
}

export function bindNewSpecTabs(doc: Document): void {
  // The form first, and nothing bound unless both are found: the stand-in
  // documents in the page script's tests answer some selectors with a
  // form of another page.
  const form = doc.querySelector(NEW_SPEC_FORM);
  const strip = form ? doc.querySelector(NEW_SPEC_TAB_STRIP) : null;
  if (!form || !strip) return;
  // On the strip, so it runs before the head scripts' listeners on
  // `document`, which leave a prevented click alone: no leave question,
  // no page cover. A click with a modifier opens the tab's own address.
  strip.addEventListener("click", ((event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    const link = (event.target as Element | null)?.closest?.("a.tab");
    const key = link ? tabOf(link) : null;
    if (!key) return;
    event.preventDefault();
    showTab(form, strip, key);
  }) as EventListener);
  // `invalid` does not bubble, hence the capture phase. Shown while it is
  // dispatched, the field is focusable by the time the browser looks for
  // one to show its message on.
  form.addEventListener(
    "invalid",
    (event: Event) => {
      const panel = (event.target as Element | null)?.closest?.("[data-tab-panel]") as HTMLElement | null;
      const key = panel?.getAttribute("data-tab-panel");
      if (panel?.hidden && key) showTab(form, strip, key);
    },
    true,
  );
}
