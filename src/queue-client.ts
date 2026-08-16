// The /queue page's browser code. TypeScript like the rest of the
// repo — `tsc --noEmit` covers it, and the server transpiles it on the
// way out. It is deliberately small: swap the table body every few
// seconds so the page stays current without reloading a form someone
// is half-way through filling in.

const REFRESH_MS = 5000;

async function swapRows(): Promise<void> {
  const body = document.getElementById("jobrows");
  if (!body) return;
  try {
    const res = await fetch("/queue?rows=1", { headers: { accept: "text/html" } });
    if (!res.ok) return; // a blip is not worth a broken page
    body.innerHTML = await res.text();
  } catch {
    // offline, server restarting, tailnet hiccup: try again next tick
  }
}

// Pause while the tab is hidden: nobody is reading, and the mini has
// better things to do than answer a laptop lid.
function tick(): void {
  if (document.visibilityState === "visible") void swapRows();
}

setInterval(tick, REFRESH_MS);
document.addEventListener("visibilitychange", tick);
