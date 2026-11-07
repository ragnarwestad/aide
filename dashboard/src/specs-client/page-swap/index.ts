import { press, chosen, chosenSteps } from "../state";
import { addScripts, onBack } from "../spec-detail/open";
import { sameAddress, takesLink } from "./links";
import { isBoardPage, placePage, servedByAnother } from "./place";

export const PAGE_LEAVE = "aide-page-leave";
export const PAGE_FETCHING = "aide-page-fetching";
export const PAGE_DRAWN = "aide-page-drawn";

export type SwapOptions = {
  history: "push" | "replace" | "none";
  keepScroll?: boolean;
  referrer?: "page" | "none";
  historyIndex?: number;
};
type MountHooks = { unmount?: () => void; mount?: (referrer: string) => void };
let hooks: MountHooks = {};
let inFlight: AbortController | null = null;
const HISTORY_INDEX = "aidePageIndex";
let shownAddress = "";
let shownIndex = 0;
let restoringHistory = false;

function indexedState(index: number): Record<string, unknown> {
  const state = history.state;
  return { ...(state && typeof state === "object" ? state : {}), [HISTORY_INDEX]: index };
}

function restoreShownAddress(targetIndex: number | undefined): void {
  if (targetIndex !== undefined && targetIndex !== shownIndex) {
    restoringHistory = true;
    history.go(shownIndex - targetIndex);
    return;
  }
  history.pushState(indexedState(shownIndex), "", shownAddress);
}

function mayLeave(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: boolean) => { if (!settled) { settled = true; resolve(answer); } };
    const event = new CustomEvent(PAGE_LEAVE, { cancelable: true, detail: { proceed: () => finish(true), stay: () => finish(false) } });
    const allowed = document.dispatchEvent(event);
    if (allowed) finish(true);
    else queueMicrotask(() => finish(false));
  });
}

export async function swapPage(target: string, options: SwapOptions): Promise<boolean> {
  if (typeof document.dispatchEvent !== "function" || typeof DOMParser === "undefined") {
    location.href = target;
    return true;
  }
  if (!shownAddress) shownAddress = location.href;
  if (!await mayLeave()) {
    if (options.history === "none") restoreShownAddress(options.historyIndex);
    return false;
  }
  document.dispatchEvent(new Event(PAGE_FETCHING));
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;
  const from = location.href;
  const scroll = { x: globalThis.scrollX ?? 0, y: globalThis.scrollY ?? 0 };
  try {
    const response = await fetch(new URL(target, from), {
      cache: "no-store",
      headers: { accept: "text/html" },
      signal: controller.signal,
      referrerPolicy: options.referrer === "none" ? "no-referrer" : undefined,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const requestedUrl = new URL(target, from);
    const finalUrl = new URL(response.url || requestedUrl.href, from);
    if (!finalUrl.hash) finalUrl.hash = requestedUrl.hash;
    if (!response.ok || !contentType.includes("text/html") || finalUrl.origin !== location.origin) throw new Error("not a board page");
    const html = await response.text();
    const next = new DOMParser().parseFromString(html, "text/html");
    if (!isBoardPage(next, finalUrl)) throw new Error("not a board page");
    // A newer server drew it: loaded whole, so the script that runs it is the new one too.
    if (servedByAnother(document, next)) throw new Error("served by a newer server");
    hooks.unmount?.();
    press.pressGen += 1;
    chosen.clear();
    chosenSteps.clear();
    if (options.history === "push") {
      shownIndex += 1;
      history.pushState(indexedState(shownIndex), "", finalUrl.href);
    } else if (options.history === "replace") history.replaceState(indexedState(shownIndex), "", finalUrl.href);
    else if (options.historyIndex !== undefined) shownIndex = options.historyIndex;
    placePage(document, next);
    addScripts(html);
    globalThis.scrollTo?.(options.keepScroll ? scroll.x : 0, options.keepScroll ? scroll.y : 0);
    if (!options.keepScroll && finalUrl.hash) {
      document.getElementById(decodeURIComponent(finalUrl.hash.slice(1)))?.scrollIntoView();
    }
    hooks.mount?.(options.referrer === "none" ? "" : from);
    document.dispatchEvent(new Event(PAGE_DRAWN));
    shownAddress = finalUrl.href;
    return true;
  } catch (error) {
    if ((error as Error).name === "AbortError") return false;
    if (options.history === "replace") location.replace(target);
    else if (options.history === "none") location.reload();
    else location.assign(target);
    return false;
  } finally {
    if (inFlight === controller) inFlight = null;
  }
}

export function bindPageSwap(doc: Document, nextHooks: MountHooks = {}): void {
  hooks = nextHooks;
  shownAddress = location.href;
  const stateIndex = history.state?.[HISTORY_INDEX];
  shownIndex = typeof stateIndex === "number" ? stateIndex : 0;
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  doc.addEventListener("click", ((event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link) return;
    const taken = takesLink(event, link, location.href);
    if (!taken) return;
    event.preventDefault();
    void swapPage(taken.url.href, { history: "push", keepScroll: sameAddress(taken.url.href, location.href), referrer: taken.referrer });
  }) as EventListener);
  globalThis.addEventListener?.("popstate", (event: Event) => {
    if (restoringHistory) {
      restoringHistory = false;
      return;
    }
    if (onBack()) return;
    const index = (event as PopStateEvent).state?.[HISTORY_INDEX];
    void swapPage(location.href, { history: "none", historyIndex: typeof index === "number" ? index : undefined });
  });
}
