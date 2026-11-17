import { swapRows, rowsPending } from "../row-swap/index.ts";
import { AWAITING, press } from "../state.ts";

export function createBatchLoader(options: { href: () => string | undefined; busy: () => boolean; load: (href: string) => Promise<void> }) {
  let pending: Promise<void> | undefined;
  let disposed = false;
  return {
    load(): Promise<void> {
      if (pending) return pending;
      const href = options.href();
      if (disposed || !href || options.busy()) return Promise.resolve();
      pending = options.load(href).catch(() => {}).finally(() => { pending = undefined; });
      return pending;
    },
    dispose() { disposed = true; },
  };
}

/** A fold can leave the old more link in the DOM. The current address
 * owns the open spec and query; the link owns the next batch size. */
export function batchAddress(href: string, here: string): URL {
  const requested = new URL(href, here);
  const current = new URL(here);
  requested.pathname = current.pathname;
  requested.hash = current.hash;
  for (const key of ["windowLoaded", "q", "project", "state", "kind", "sort", "dir", "open", "checks", "phases", "created"]) {
    const value = current.searchParams.get(key);
    if (value) requested.searchParams.set(key, value);
    else requested.searchParams.delete(key);
  }
  return requested;
}

let disconnect: (() => void) | undefined;
let loading = false;

/** Rebound after accepted row replacements, disconnected when the page leaves. */
export function bindListWindow(doc: Document = document): () => void {
  disconnect?.();
  const body = doc.getElementById("jobrows");
  const link = body?.querySelector?.("a[data-list-more]") as HTMLAnchorElement | null;
  if (!body || !link) { disconnect = undefined; return () => {}; }
  const loader = createBatchLoader({
    href: () => link.isConnected ? link.href : undefined,
    busy: () => loading || press.inFlight > 0,
    load: async (href) => {
      const before = location.href;
      const requested = batchAddress(href, before);
      loading = true;
      press.pressGen++;
      press.inFlight++;
      history.replaceState(null, "", requested.pathname + requested.search + requested.hash);
      let accepted = false;
      try { await swapRows(() => { accepted = true; }); }
      finally {
        if (!accepted && location.href === requested.href) history.replaceState(null, "", before);
        loading = false;
        press.inFlight--;
      }
    },
  });
  const click = (event: Event) => {
    const mouse = event as MouseEvent;
    if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey || mouse.button !== 0) return;
    event.preventDefault();
    void loader.load();
  };
  link.addEventListener("click", click);
  let observer: IntersectionObserver | undefined;
  if (typeof IntersectionObserver !== "undefined") {
    const wrap = link.closest(".tablewrap") as HTMLElement | null;
    const root = wrap && wrap.scrollHeight > wrap.clientHeight && /auto|scroll/.test(getComputedStyle(wrap).overflowY) ? wrap : null;
    observer = new IntersectionObserver((entries) => {
      if (!rowsPending() && !body.classList.contains(AWAITING) && entries.some((entry) => entry.isIntersecting)) void loader.load();
    }, { root, rootMargin: "200px" });
    observer.observe(link);
  }
  const cleanup = () => { observer?.disconnect(); loader.dispose(); link.removeEventListener("click", click); };
  disconnect = cleanup;
  return () => { disconnect?.(); disconnect = undefined; };
}

/** Accepted metadata replaces the load request's transient `grow` flag.
 * A subsequent live refresh reconciles the boundary rather than growing again. */
export function acceptListWindow(body: Element): void {
  const window = body.querySelector?.("[data-window-query]") as HTMLElement | null;
  if (!window) return;
  const url = new URL(location.href);
  url.searchParams.delete("grow");
  if (window.dataset.windowLoaded) url.searchParams.set("windowLoaded", window.dataset.windowLoaded);
  if (url.searchParams.has("limit") && window.dataset.windowLimit) url.searchParams.set("limit", window.dataset.windowLimit);
  if (window.dataset.windowBoundary) url.searchParams.set("boundary", window.dataset.windowBoundary);
  else url.searchParams.delete("boundary");
  url.searchParams.set("windowQuery", window.dataset.windowQuery ?? "");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  // Held spec detail keeps its DOM, so its tab links must receive the
  // accepted range too; they were drawn before this batch was loaded.
  for (const link of body.querySelectorAll<HTMLAnchorElement>("tr[data-spec-detail] a.tab")) {
    const target = new URL(link.href, location.href);
    if (target.pathname !== url.pathname) continue;
    for (const key of ["state", "project", "sort", "dir", "q", "limit", "boundary", "windowQuery", "windowLoaded"]) {
      const value = url.searchParams.get(key);
      if (value) target.searchParams.set(key, value);
      else target.searchParams.delete(key);
    }
    link.href = target.pathname + target.search + target.hash;
  }
}
