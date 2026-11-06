// A click on another provider, on a tab of the chosen provider's panel, or
// on Check again changes only the list and the chosen provider: the tab is
// fetched and its two parts put in place of the ones shown, and the address
// follows. The page is not loaded again, so nothing else on it flashes. A
// fetch that fails loads the page as a link would.

const SWAPPED = [".providershead", ".providerpanes"];

/** The address of a link that stays on the Providers tab, else null. */
export function providersAddress(href: string, here: string): URL | null {
  const url = new URL(href, here);
  const now = new URL(here);
  return url.origin === now.origin && url.pathname === "/settings" && url.searchParams.get("tab") === "providers" ? url : null;
}

export function bindProviderSwap(doc: Document, after: (root: ParentNode) => void, fetchImpl: typeof fetch = fetch): void {
  if (!doc.querySelector(".providerpanes")) return;
  async function swap(url: URL, push: boolean): Promise<void> {
    try {
      const res = await fetchImpl(url.toString(), { headers: { accept: "text/html" } });
      if (!res.ok) throw new Error(String(res.status));
      const next = new DOMParser().parseFromString(await res.text(), "text/html");
      for (const sel of SWAPPED) {
        const old = doc.querySelector(sel);
        const fresh = next.querySelector(sel);
        if (!old || !fresh) throw new Error(`no ${sel}`);
        old.replaceWith(doc.importNode(fresh, true));
      }
      if (push) history.pushState(null, "", url.toString());
      for (const sel of SWAPPED) {
        const part = doc.querySelector(sel);
        if (part) after(part);
      }
    } catch {
      location.href = url.toString();
    }
  }
  // Capture: ahead of the cover a link that leaves the page shows.
  doc.addEventListener(
    "click",
    (event) => {
      const e = event as MouseEvent;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || !link.closest(SWAPPED.join(", "))) return;
      const url = providersAddress(link.getAttribute("href") ?? "", location.href);
      if (!url) return;
      e.preventDefault();
      void swap(url, true);
    },
    { capture: true },
  );
  window.addEventListener("popstate", () => {
    const url = providersAddress(location.href, location.href);
    if (url) void swap(url, false);
  });
}
