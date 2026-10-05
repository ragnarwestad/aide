// --- spec 189: the server says when, and the page listens ------------------
//
// This used to be a five-second timer that fetched the rows whether
// anything had happened or not. Two costs came out of that: a reader
// with the browser's own tools open had the ground move under them
// twelve times a minute, and a step that finished waited up to five
// seconds to show. The connection below replaces both — the page draws
// when the server says something moved, and holds perfectly still
// otherwise.

import { createFollow } from "./follow";
import { swapRows } from "./row-swap.ts";
import { press } from "./state.ts";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

let source: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = RECONNECT_BASE_MS;
/** Whether this page has been hidden since it was drawn — what tells a
 *  return to the foreground from the first paint. */
let wasHidden = false;
/** The phases the open stream was asked with. */
let streamPhases = "";

// A job page and a spec's Steps tab follow their job in place: what the feed
// tells them, they ask their own address for. A page without the follow
// marker asks nothing.
const follow = createFollow({
  doc: document,
  win: typeof window === "undefined" ? undefined : window,
  fetch: (url) => fetch(url, { headers: { accept: "text/html" } }),
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  location,
  replaceState: (url) => history.replaceState(null, "", url),
  busy: () => press.inFlight > 0,
  // The server tells a tab about a growing log only when the stream's own
  // query named that phase, and an answer's marker can name them later than
  // the page did.
  phasesChanged: () => {
    if (follow.phases() === streamPhases) return;
    disconnect();
    connect();
  },
});

function clearReconnectTimer(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

// Pause while a press is in flight: the server still shows the OLD
// state until it answers, so a swap in that window would put an
// untouched button back over the "merging…" the press just showed —
// the click looked unregistered, and then the row jumped.
export function onChanged(): void {
  if (press.inFlight === 0) {
    void swapRows();
    follow.request();
  }
}

// The page's own query goes with it, so the stream is asked with the same
// filter and state the page was; a followed page adds the phases its marker
// names.
function streamUrl(): string {
  streamPhases = follow.phases();
  if (!streamPhases) return `/api/queue/events${location.search}`;
  const params = new URLSearchParams(location.search);
  params.set("phases", streamPhases);
  return `/api/queue/events?${params}`;
}

export function connect(): void {
  // `?live=0` is asked HERE and not only at start-up: the tab going
  // hidden and visible again comes back through this, and a page told
  // to hold still has to stay held.
  if (new URLSearchParams(location.search).get("live") === "0") return;
  if (source || document.visibilityState !== "visible") return;
  clearReconnectTimer();
  source = new EventSource(streamUrl());
  // `open` fires on the first connect AND on every reconnect the
  // browser makes on its own — after a dropped network, after the
  // server was restarted under the page. Redrawing here is what picks
  // up whatever changed while the connection was down, so nobody has
  // to reload.
  source.addEventListener("open", () => {
    backoffMs = RECONNECT_BASE_MS;
    void swapRows();
    follow.request();
  });
  source.addEventListener("changed", onChanged);
  source.addEventListener("error", onError);
}

// A dropped network is the browser's own problem: `readyState` goes
// back to CONNECTING and it retries by itself, `open` firing (and
// resyncing) when it lands. Only a permanently failed connection — a
// non-200 answer, e.g. a proxy's 502 while the server restarts — sets
// `readyState` to CLOSED, and that is the one case `EventSource` will
// not come back from on its own.
function onError(): void {
  if (source?.readyState !== EventSource.CLOSED) return;
  source = null;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, backoffMs);
  backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
}

export function disconnect(): void {
  clearReconnectTimer();
  source?.close();
  source = null;
}

// Let go while the tab is hidden: nobody is reading, and the mini has
// better things to do than hold a socket open for a closed laptop —
// the same reason the timer used to skip while hidden, applied to the
// connection itself.
export function onVisibility(): void {
  if (document.visibilityState !== "visible") {
    wasHidden = true;
    disconnect();
    return;
  }
  // Coming BACK: the rows first, then the connection. A phone coming
  // back from the lock screen takes seconds to get its stream up again,
  // and the page used to wait for `open` before redrawing — long enough
  // to read a list that had moved on minutes ago (2026-09-20). The first
  // paint is not this: the server has just drawn the page.
  if (wasHidden && press.inFlight === 0) {
    void swapRows();
    follow.request();
  }
  wasHidden = false;
  connect();
}
