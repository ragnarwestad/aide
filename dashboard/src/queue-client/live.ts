// --- spec 189: the server says when, and the page listens ------------------
//
// This used to be a five-second timer that fetched the rows whether
// anything had happened or not. Two costs came out of that: a reader
// with the browser's own tools open had the ground move under them
// twelve times a minute, and a step that finished waited up to five
// seconds to show. The connection below replaces both — the page draws
// when the server says something moved, and holds perfectly still
// otherwise.

import { swapRows } from "./row-swap.ts";
import { press } from "./state.ts";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

let source: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = RECONNECT_BASE_MS;

function clearReconnectTimer(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

// Pause while a press is in flight: the server still shows the OLD
// state until it answers, so a swap in that window would put an
// untouched button back over the "merging…" the press just showed —
// the click looked unregistered, and then the row jumped.
export function onChanged(): void {
  if (press.inFlight === 0) void swapRows();
}

// The page's own query string goes with it. On the first load of a
// bookmarked page the token is in the address bar and nowhere else,
// and `EventSource` has no other way to carry one: it cannot set a
// header, and the cookie the page is about to be given is not there
// yet. Afterwards the cookie answers for it, same-origin, by itself.
export function connect(): void {
  // `?live=0` is asked HERE and not only at start-up: the tab going
  // hidden and visible again comes back through this, and a page told
  // to hold still has to stay held.
  if (new URLSearchParams(location.search).get("live") === "0") return;
  if (source || document.visibilityState !== "visible") return;
  clearReconnectTimer();
  source = new EventSource(`/api/queue/events${location.search}`);
  // `open` fires on the first connect AND on every reconnect the
  // browser makes on its own — after a dropped network, after the
  // server was restarted under the page. Redrawing here is what picks
  // up whatever changed while the connection was down, so nobody has
  // to reload.
  source.addEventListener("open", () => {
    backoffMs = RECONNECT_BASE_MS;
    void swapRows();
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
  if (document.visibilityState === "visible") connect();
  else disconnect();
}
