import { press, chosen, chosenSteps } from "../state";
import { addScripts, onBack } from "../spec-detail/open";
import { sameAddress, takesLink } from "./links";
import { isBoardPage, placePage, servedByAnother } from "./place";
import { rememberPage, rememberedPage } from "./remember";
export { PAGE_DRAWN, PAGE_FETCHING, PAGE_LEAVE } from "../../page-contract.ts";
import { PAGE_DRAWN, PAGE_FETCHING, PAGE_LEAVE } from "../../page-contract.ts";

export type SwapOptions = {
  history: "push" | "replace" | "none";
  keepScroll?: boolean;
  referrer?: "page" | "none";
  historyIndex?: number;
  remembered?: boolean;
};
type MountHooks = { unmount?: () => void; mount?: (options: { referrer: string; background: boolean }) => void };
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

type DrawOptions = {
  history: SwapOptions["history"];
  historyIndex?: number;
  scroll: "top" | "kept" | { x: number; y: number };
  referrer: string;
  background: boolean;
  html: string;
};

function draw(next: Document, url: URL, options: DrawOptions): void {
  const keptScroll = options.scroll === "kept"
    ? { x: globalThis.scrollX ?? 0, y: globalThis.scrollY ?? 0, list: document.querySelector("#jobrows .tablewrap")?.scrollTop ?? 0 }
    : null;
  hooks.unmount?.();
  press.pressGen += 1;
  chosen.clear();
  chosenSteps.clear();
  if (options.history === "push") {
    shownIndex += 1;
    history.pushState(indexedState(shownIndex), "", url.href);
  } else if (options.history === "replace") history.replaceState(indexedState(shownIndex), "", url.href);
  else if (options.historyIndex !== undefined) shownIndex = options.historyIndex;
  placePage(document, next);
  if (options.html) addScripts(options.html);
  if (options.scroll !== "kept") {
    const point = options.scroll === "top" ? { x: 0, y: 0 } : options.scroll;
    globalThis.scrollTo?.(point.x, point.y);
    if (options.scroll === "top" && url.hash) {
      document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView();
    }
  }
  hooks.mount?.({ referrer: options.referrer, background: options.background });
  if (keptScroll) {
    globalThis.scrollTo?.(keptScroll.x, keptScroll.y);
    const list = document.querySelector("#jobrows .tablewrap");
    if (list) list.scrollTop = keptScroll.list;
  }
  document.dispatchEvent(new Event(PAGE_DRAWN));
  shownAddress = url.href;
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
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;
  const from = location.href;
  const requestedUrl = new URL(target, from);
  const referrer = options.referrer === "none" ? "" : from;
  const scroll = { x: globalThis.scrollX ?? 0, y: globalThis.scrollY ?? 0 };
  let copy: Document | null = null;
  try {
    const answer = fetch(requestedUrl, {
      cache: "no-store",
      headers: { accept: "text/html" },
      signal: controller.signal,
      referrerPolicy: options.referrer === "none" ? "no-referrer" : undefined,
    });
    const elsewhere = !sameAddress(requestedUrl.href, shownAddress);
    if (elsewhere) rememberPage(shownAddress, document);
    const kept = options.remembered && elsewhere ? rememberedPage(requestedUrl.href) : null;
    copy = kept && isBoardPage(kept, requestedUrl) ? kept : null;
    if (copy) {
      draw(copy, requestedUrl, {
        history: options.history,
        historyIndex: options.historyIndex,
        scroll: "top",
        referrer,
        background: false,
        html: "",
      });
    }
    document.dispatchEvent(new Event(PAGE_FETCHING));
    const response = await answer;
    const contentType = response.headers.get("content-type") ?? "";
    const finalUrl = new URL(response.url || requestedUrl.href, from);
    if (!finalUrl.hash) finalUrl.hash = requestedUrl.hash;
    if (!response.ok || !contentType.includes("text/html") || finalUrl.origin !== location.origin) throw new Error("not a board page");
    const html = await response.text();
    const next = new DOMParser().parseFromString(html, "text/html");
    if (!isBoardPage(next, finalUrl)) throw new Error("not a board page");
    // A newer server drew it: loaded whole, so the script that runs it is the new one too.
    if (servedByAnother(document, next)) throw new Error("served by a newer server");
    draw(next, finalUrl, {
      history: copy && options.history !== "none" ? "replace" : options.history,
      historyIndex: options.historyIndex,
      scroll: copy ? "kept" : options.keepScroll ? scroll : "top",
      referrer,
      background: true,
      html,
    });
    return true;
  } catch (error) {
    if ((error as Error).name === "AbortError") return false;
    if (copy || options.history === "none") location.reload();
    else if (options.history === "replace") location.replace(target);
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
  if (typeof history.pushState === "function" && typeof history.replaceState === "function") {
    const pushState = history.pushState.bind(history);
    const replaceState = history.replaceState.bind(history);
    history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
      rememberPage(shownAddress, document);
      pushState(data, unused, url);
      shownAddress = location.href;
    };
    history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
      rememberPage(shownAddress, document);
      replaceState(data, unused, url);
      shownAddress = location.href;
    };
  }
  doc.addEventListener("click", ((event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link) return;
    const taken = takesLink(event, link, location.href);
    if (!taken) return;
    event.preventDefault();
    void swapPage(taken.url.href, { history: "push", keepScroll: sameAddress(taken.url.href, location.href), referrer: taken.referrer, remembered: true });
  }) as EventListener);
  globalThis.addEventListener?.("popstate", (event: Event) => {
    if (restoringHistory) {
      restoringHistory = false;
      return;
    }
    if (onBack()) {
      shownAddress = location.href;
      return;
    }
    const index = (event as PopStateEvent).state?.[HISTORY_INDEX];
    void swapPage(location.href, { history: "none", historyIndex: typeof index === "number" ? index : undefined, remembered: true });
  });
}
