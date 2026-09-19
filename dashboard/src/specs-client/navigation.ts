// The row-swap link on this page: one that stays and swaps the rows in
// place rather than loading a new document. The other kind — a link
// that leaves the page — is `nav-busy.ts`'s now, run on every page
// rather than wired up here (spec 312).

import { connect, disconnect } from "./live.ts";
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
  const phasesBefore = new URLSearchParams(location.search).get("phases");
  history.replaceState(null, "", link.getAttribute("href") ?? location.href);
  // The server tells a tab about a growing transcript only when the
  // stream's own query named that phase (spec 500), so a change of
  // `phases` reopens the stream; a sort or a row fold leaves it alone.
  if (new URLSearchParams(location.search).get("phases") !== phasesBefore) {
    disconnect();
    connect();
  }
  // Spec 208. SOMETHING has to change the moment it is pressed — the
  // same rule the buttons have kept since spec 96/101, applied to the
  // fold and the sort links, which changed nothing at all between the
  // click and the fetch resolving. The container carries it, because
  // the page stays and the rows are what get replaced.
  document.getElementById("jobrows")?.classList.add(AWAITING);
  void swapRows();
}
