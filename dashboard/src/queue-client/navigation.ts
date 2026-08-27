// The two kinds of link on this page: one that stays and swaps the
// rows in place, one that leaves for another document. Split out of
// queue-client.ts (split queue-client.ts into a bundled folder).

import { swapRows } from "./row-swap.ts";
import { AWAITING } from "./state.ts";

// A filter link is a real link and works without this. Intercepting it
// keeps the promise the rest of this file makes: never reload the page
// under a control somebody is half-way through setting.
export function navigate(event: MouseEvent): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  const link = (event.target as Element | null)?.closest?.("a[data-nav]") as HTMLAnchorElement | null;
  if (!link) return;
  event.preventDefault();
  history.replaceState(null, "", link.getAttribute("href") ?? location.href);
  // Spec 208. SOMETHING has to change the moment it is pressed — the
  // same rule the buttons have kept since spec 96/101, applied to the
  // fold and the sort links, which changed nothing at all between the
  // click and the fetch resolving. The container carries it, because
  // the page stays and the rows are what get replaced.
  document.getElementById("jobrows")?.classList.add(AWAITING);
  void swapRows();
}

/** A click on a link that leaves this page for another document — a
 *  spec's own name, or a tab (spec 208).
 *
 *  It does NOT `preventDefault()`. There is nothing to intercept: the
 *  browser's own navigation is the correct behaviour, and
 *  re-implementing a page load in script to get a spinner would be a
 *  bad trade. The only thing wrong today is that the click is
 *  invisible — the new document does not start arriving until the
 *  server has finished rendering it, so the reader sees the OLD page,
 *  unchanged, for the whole wait.
 *
 *  On the DOCUMENT, not on `#jobrows`: the tab bar sits outside it. */
export function markGoing(event: MouseEvent): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  const link = (event.target as Element | null)?.closest?.("a[data-goto]") as HTMLAnchorElement | null;
  link?.classList.add(AWAITING);
}
