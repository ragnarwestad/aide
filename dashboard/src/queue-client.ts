// The /specs page's browser code. TypeScript like the rest of the
// repo — `tsc --noEmit` covers it, and the server transpiles it on the
// way out.
//
// One job now: keep the table current WITHOUT reloading the page, which
// would wipe a control someone is half-way through setting.
//
// It used to have a second — answering the spec dropdown above the
// table, which had to update the step boxes, the "also touches" list
// and a summary line whenever the selection changed. Every spec has its
// own row-scoped control now, rendered by the server, so there is no
// selection left to react to and none of that code has a caller.

const REFRESH_MS = 5000;

// The filter and the sort live in the address bar, so the refresh has
// to ask for the same list the reader is looking at — otherwise every
// tick would quietly throw the filter away.
async function swapRows(): Promise<void> {
  const body = document.getElementById("jobrows");
  if (!body) return;
  const params = new URLSearchParams(location.search);
  params.delete("token");
  params.set("rows", "1");
  try {
    const res = await fetch(`/specs?${params}`, { headers: { accept: "text/html" } });
    if (!res.ok) return; // a blip is not worth a broken page
    body.innerHTML = await res.text();
  } catch {
    // offline, server restarting, tailnet hiccup: try again next tick
  }
}

// A filter link is a real link and works without this. Intercepting it
// keeps the promise the rest of this file makes: never reload the page
// under a control somebody is half-way through setting.
function navigate(event: MouseEvent): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  const link = (event.target as Element | null)?.closest?.("a[data-nav]") as HTMLAnchorElement | null;
  if (!link) return;
  event.preventDefault();
  history.replaceState(null, "", link.getAttribute("href") ?? location.href);
  void swapRows();
}

// Pause while the tab is hidden: nobody is reading, and the mini has
// better things to do than answer a closed laptop.
function tick(): void {
  if (document.visibilityState === "visible") void swapRows();
}

// Delegated from the container, because the controls are replaced along
// with the rows on every tick — a listener on the links themselves
// would last five seconds.
document.getElementById("jobrows")?.addEventListener("click", navigate as EventListener);
document.addEventListener("visibilitychange", tick);
setInterval(tick, REFRESH_MS);
