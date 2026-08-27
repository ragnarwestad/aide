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

let source: EventSource | null = null;

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
  source = new EventSource(`/api/queue/events${location.search}`);
  // `open` fires on the first connect AND on every reconnect the
  // browser makes on its own — after a dropped network, after the
  // server was restarted under the page. Redrawing here is what picks
  // up whatever changed while the connection was down, so nobody has
  // to reload.
  source.addEventListener("open", () => void swapRows());
  source.addEventListener("changed", onChanged);
}

export function disconnect(): void {
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
