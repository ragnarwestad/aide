// "← Back" on a page with tabs. The server works Back out from the
// Referer, and every tab is a page load whose Referer is the page itself,
// which the server can only answer with the page's default. So the page
// remembers, for this browser tab, the Back the server drew when the page
// was opened from somewhere else, and puts it back on every load of the
// page from itself — a tab, an Edit link, a save that loads it again.

import { isBoardPath } from "../../format/board-path.ts";

/** The page's own address: the parts of `location` this needs. */
export interface Here {
  href: string;
  host: string;
  pathname: string;
}

/** Where `keepBack()` reads what it decides from. */
export interface BackIo {
  referrer(): unknown;
  here(): Here;
  storage(): Storage;
}

/** An address — a referrer or a link — that is this page: the same host
 *  and the same path, any query. An empty one is no page at all. */
export function isThisPage(address: unknown, here: Here): boolean {
  if (typeof address !== "string" || address === "") return false;
  try {
    const url = new URL(address, here.href);
    return url.host === here.host && url.pathname === here.pathname;
  } catch {
    return false;
  }
}

/** Where Back goes on a page with tabs, and what to remember for the
 *  page's next load. Opened from anywhere but itself — another page, or
 *  nowhere — the server's Back stands and is remembered, replacing what
 *  an earlier visit left. Loaded from itself, the remembered Back is used
 *  when it is a path on this board other than the page itself. */
export function keptBack(o: { served: string; referrer: unknown; here: Here; stored: string | null }): {
  href: string;
  remember?: string;
} {
  if (!isThisPage(o.referrer, o.here)) return { href: o.served, remember: o.served };
  const usable = isBoardPath(o.stored) && !isThisPage(o.stored, o.here);
  return { href: usable ? (o.stored as string) : o.served };
}

/** Puts the remembered Back on `a.backlink[data-keep]`, or remembers the
 *  one the server drew. A page without that link is left alone, and
 *  anything that cannot be read or written leaves Back as the server drew
 *  it: this runs last on every page and must never stop the page script. */
export function keepBack(
  doc: Document,
  io: BackIo = {
    referrer: () => doc.referrer,
    here: () => ({ href: location.href, host: location.host, pathname: location.pathname }),
    storage: () => sessionStorage,
  },
): void {
  try {
    const link = doc.querySelector?.("a.backlink[data-keep]");
    if (!link) return;
    const served = link.getAttribute("href") ?? "";
    const here = io.here();
    const key = `back:${here.pathname}`;
    let storage: Storage | null = null;
    let stored: string | null = null;
    try {
      storage = io.storage();
      stored = storage.getItem(key);
    } catch {
      // No storage, blocked, or refusing: nothing remembered.
    }
    const { href, remember } = keptBack({ served, referrer: io.referrer(), here, stored });
    if (href !== served) link.setAttribute("href", href);
    if (remember !== undefined) storage?.setItem(key, remember);
  } catch {
    // Back stays what the server drew.
  }
}
