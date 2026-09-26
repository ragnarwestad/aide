// The row-swap link on this page: one that stays and swaps the rows in
// place rather than loading a new document. The other kind — a link
// that leaves the page — is `nav-busy.ts`'s now, run on every page
// rather than wired up here (spec 312).

import { connect, disconnect } from "./live.ts";
import { SPINNER } from "./press.ts";
import { swapRows, swapSpec } from "./row-swap.ts";
import { AWAITING } from "./state.ts";

/** The parts of the address one spec's › opens or shuts, and so the only
 *  ones a swap of that spec alone leaves stale in every OTHER link's
 *  href: the links are taken from the address instead. */
const FOLDS = ["open", "checks"] as const;

// A filter link is a real link and works without this. Intercepting it
// keeps the promise the rest of this file makes: never reload the page
// under a control somebody is half-way through setting.
export function navigate(event: MouseEvent): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  const link = (event.target as Element | null)?.closest?.("a[data-nav]") as HTMLAnchorElement | null;
  if (!link) return;
  event.preventDefault();
  const fold = link.getAttribute("data-fold");
  const key = link.getAttribute("data-key");
  if (fold && key && (FOLDS as readonly string[]).includes(fold)) {
    void foldOne(link, fold, key);
    return;
  }
  const phasesBefore = new URLSearchParams(location.search).get("phases");
  history.replaceState(null, "", withFolds(link.getAttribute("href") ?? location.href));
  // The server tells a tab about a growing transcript only when the
  // stream's own query named that phase (spec 500), so a change of
  // `phases` reopens the stream; a sort or a row fold leaves it alone.
  if (new URLSearchParams(location.search).get("phases") !== phasesBefore) {
    disconnect();
    connect();
  }
  // Spec 208. SOMETHING has to change the moment it is pressed — the
  // same rule the buttons have kept since spec 96/101, applied to the
  // sort and the filter links, which changed nothing at all between the
  // click and the fetch resolving. The container carries it, because
  // the page stays and the rows are what get replaced.
  document.getElementById("jobrows")?.classList.add(AWAITING);
  void swapRows();
}

/** A spec's own › — its row or its criteria. The address is worked out
 *  here from the address itself, not from the link: after an earlier ›
 *  swapped only its own spec, every other link on the page still names
 *  the folds as they were before it. The chevron turns into a spinner
 *  until the row is back, which a phone shows as well as a desktop; the
 *  busy mouse pointer the whole list wore said nothing on a phone. */
async function foldOne(link: HTMLAnchorElement, fold: string, key: string): Promise<void> {
  const params = new URLSearchParams(location.search);
  const keys = (params.get(fold) ?? "").split(",").filter(Boolean);
  const next = keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
  if (next.length) params.set(fold, next.join(","));
  else params.delete(fold);
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}`);
  const chevron = link.innerHTML;
  link.innerHTML = SPINNER;
  await swapSpec(key);
  // Still on the page only when no swap drew the row again — offline, or
  // the server restarting — and a spinner left there would say it is
  // still working on something that is over.
  if (link.isConnected) link.innerHTML = chevron;
}

/** A link's href with the folds taken from the address. */
function withFolds(href: string): string {
  const url = new URL(href, location.href);
  if (url.pathname !== location.pathname) return href;
  const now = new URLSearchParams(location.search);
  for (const name of FOLDS) {
    const value = now.get(name);
    if (value) url.searchParams.set(name, value);
    else url.searchParams.delete(name);
  }
  return `${url.pathname}${url.search}`;
}
