// --- The server says when, and the page listens ------------------
//
// This used to be a five-second timer that fetched the rows whether
// anything had happened or not. Two costs came out of that: a reader
// with the browser's own tools open had the ground move under them
// twelve times a minute, and a step that finished waited up to five
// seconds to show. The connection below replaces both — the page draws
// when the server says something moved, and holds perfectly still
// otherwise.

import { swapRows } from "./row-swap/index.ts";
import { press } from "./state.ts";
import { browserMarkIo, refreshDeployMark } from "./deploy/mark.ts";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

let source: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = RECONNECT_BASE_MS;
/** Whether this page has been hidden since it was drawn — what tells a
 *  return to the foreground from the first paint. */
let wasHidden = false;

function clearReconnectTimer(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

// Pause while a press is in flight: the server still shows the OLD
// state until it answers, so a swap in that window would put an
// untouched button back over the "merging…" the press just showed —
// the click looked unregistered, and then the row jumped.
let refreshing = false;
let refreshAgain = false;

async function refreshRows(): Promise<void> {
  if (refreshing || press.inFlight > 0) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  try {
    do {
      refreshAgain = false;
      await swapRows();
    } while (refreshAgain && press.inFlight === 0);
  } finally {
    refreshing = false;
  }
}

/** Apply changes held back while a row was opening or closing. */
export function resumeRowUpdates(): void {
  if (refreshAgain && press.inFlight === 0) {
    void refreshRows();
  }
}

export function onChanged(): void {
  document.dispatchEvent(new Event("aide:queue-changed"));
  void refreshRows();
}

// Queue counts update independently of row redraws and presses in flight.
// The app icon receives its waiting count as an event; the Jobs tab shows
// jobs that need attention, including zero.
function announceCounts(e: Event): void {
  let waiting: unknown;
  let activeJobs: unknown;
  let openSpecs: unknown;
  try {
    const counts = JSON.parse(String((e as MessageEvent).data));
    waiting = counts.waiting;
    activeJobs = counts.activeJobs;
    openSpecs = counts.openSpecs;
  } catch {
    return;
  }
  if (typeof waiting === "number" && Number.isInteger(waiting) && waiting >= 0) {
    document.dispatchEvent(new CustomEvent("aide:waiting", { detail: waiting }));
  }
  if (typeof activeJobs === "number" && Number.isInteger(activeJobs) && activeJobs >= 0) {
    for (const count of document.querySelectorAll('nav.tabbar a[href="/"] [data-tab-count]')) count.textContent = ` (${activeJobs})`;
  }
  if (typeof openSpecs === "number" && Number.isInteger(openSpecs) && openSpecs >= 0) {
    for (const count of document.querySelectorAll('nav.tabbar a[href="/specs"] [data-tab-count]')) count.textContent = ` (${openSpecs})`;
  }
}

// The page's own query goes with it, so the stream is asked with the same
// filter and state the page was.
// `deploy=1` asks for what the board has to deploy now, for the header's mark.
function streamUrl(): string {
  const params = new URLSearchParams(location.search);
  params.set("deploy", "1");
  params.set("counts", "1");
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
    void refreshDeployMark(browserMarkIo());
    document.dispatchEvent(new Event("aide:queue-changed"));
    void refreshRows();
  });
  source.addEventListener("changed", onChanged);
  source.addEventListener("changed", announceCounts);
  source.addEventListener("changed", () => void refreshDeployMark(browserMarkIo()));
  source.addEventListener("counts", announceCounts);
  source.addEventListener("deploy", () => void refreshDeployMark(browserMarkIo()));
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
    document.dispatchEvent(new Event("aide:queue-changed"));
    void refreshRows();
  }
  wasHidden = false;
  connect();
}
