// A page that follows its job in place. A job page and a spec's Steps tab
// carry `[data-follow]` while their job is in flight; on each thing the live
// feed tells the page, it asks its own address with `follow=1` and the server
// answers the page's moving parts alone. The page script swaps only what
// differs and keeps the reader's place. A page without the marker asks
// nothing, and an answer without one ends the following.

import { boxesIn, measureBox, restoreBox, selectionHolds } from "./place.ts";
import { swapParts } from "./swap.ts";

/** No two asks start less than this far apart. */
export const MIN_GAP_MS = 2000;

/** What following touches, handed in so it can be driven without a browser. */
export interface FollowEnv {
  doc: Document;
  /** The window, for the page's scroll and the selection. Absent where there is none. */
  win?: Pick<Window, "scrollX" | "scrollY" | "scrollTo" | "getSelection">;
  fetch: (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  location: { pathname: string; search: string };
  /** Move the address bar without loading a document. */
  replaceState: (url: string) => void;
  /** A press is in flight: its own answer is what the page draws next. */
  busy: () => boolean;
  /** The marker's phases may have changed: the event stream is asked to look. */
  phasesChanged: () => void;
}

export function createFollow(env: FollowEnv): { request: () => void; phases: () => string } {
  let out = false;
  let again = false;
  let scheduled = false;
  let lastStart: number | undefined;
  /** An answer whose swap left something for a selection to release. */
  let pending: ParentNode | null = null;
  let listening = false;

  const marker = (): Element | null => env.doc.querySelector("[data-follow]");
  const phases = (): string => marker()?.getAttribute("data-phases") ?? "";
  const declined = (): boolean => new URLSearchParams(env.location.search).get("live") === "0";

  /** The ask's query: the page's own, with the tab and the running step the
   *  marker names where the address has none. Both are written into the
   *  address too: a job page opened with no `tab` would otherwise be answered
   *  for Overview once its job ends, and the next step to start would open in
   *  the place of the row the reader was reading. */
  function query(mark: Element): URLSearchParams {
    const params = new URLSearchParams(env.location.search);
    let pinned = false;
    const tab = mark.getAttribute("data-tab");
    if (tab && !params.has("tab")) {
      params.set("tab", tab);
      pinned = true;
    }
    const running = mark.getAttribute("data-running");
    const step = params.get("step");
    if (running !== null && (step === null || step === "live") && step !== running) {
      params.set("step", running);
      pinned = true;
    }
    if (pinned) env.replaceState(`${env.location.pathname}?${params}`);
    params.set("follow", "1");
    return params;
  }

  function apply(answer: ParentNode): void {
    const win = env.win;
    const y = win?.scrollY;
    const boxes = boxesIn(env.doc).map(measureBox);
    pending = null;
    if (swapParts(env.doc, answer, (node) => selectionHolds(win, node))) {
      pending = answer;
      if (!listening) {
        listening = true;
        env.doc.addEventListener("selectionchange", () => pending && apply(pending));
      }
    }
    boxesIn(env.doc).forEach((box, i) => boxes[i] && restoreBox(box, boxes[i]!));
    if (win && y !== undefined && win.scrollY !== y) win.scrollTo(win.scrollX, y);
    const mine = marker();
    const next = answer.querySelector("[data-follow]");
    if (mine) {
      if (next) mine.replaceWith(next.cloneNode(true));
      else mine.remove();
    }
    env.phasesChanged();
  }

  async function run(mark: Element): Promise<void> {
    out = true;
    again = false;
    lastStart = env.now();
    try {
      const res = await env.fetch(`${env.location.pathname}?${query(mark)}`);
      if (!res.ok) return;
      const template = env.doc.createElement("template");
      template.innerHTML = await res.text();
      apply(template.content);
    } catch {
      // offline, or the server restarting: the stream's next `open` asks again
    } finally {
      out = false;
      if (again) request();
    }
  }

  /** Ask now, or when the pace allows: one ask at a time, and the events in
   *  between give one more after it. */
  function request(): void {
    const mark = marker();
    if (!mark || declined() || env.busy()) return;
    if (out) {
      again = true;
      return;
    }
    const wait = lastStart === undefined ? 0 : lastStart + MIN_GAP_MS - env.now();
    if (wait > 0) {
      again = true;
      if (!scheduled) {
        scheduled = true;
        env.setTimeout(() => {
          scheduled = false;
          request();
        }, wait);
      }
      return;
    }
    void run(mark);
  }

  return { request, phases };
}
