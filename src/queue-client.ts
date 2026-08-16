// The /queue page's browser code. TypeScript like the rest of the
// repo — `tsc --noEmit` covers it, and the server transpiles it on the
// way out.
//
// Two jobs, both small:
//   * answer the selection. A dropdown that changes nothing visible
//     reads as broken, however correct it is.
//   * keep the table current WITHOUT reloading the page, which would
//     wipe a half-filled form.

interface QueueTarget {
  project: string;
  specFolder: string;
  title?: string;
  phase?: string;
  percent?: number;
}

const REFRESH_MS = 5000;

function targets(): QueueTarget[] {
  const el = document.getElementById("targetdata");
  if (!el?.textContent) return [];
  try {
    return JSON.parse(el.textContent) as QueueTarget[];
  } catch {
    return [];
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function summary(t: QueueTarget): string {
  const bits: string[] = [];
  if (t.title) bits.push(escapeHtml(t.title));
  if (t.phase) bits.push(`<span class="chip">${escapeHtml(t.phase)}</span>`);
  if (typeof t.percent === "number") bits.push(`${t.percent}% done`);
  return bits.length ? bits.join(" · ") : `<span class="muted">no status recorded yet</span>`;
}

function showSelection(): void {
  const select = document.getElementById("target") as HTMLSelectElement | null;
  const info = document.getElementById("specinfo");
  if (!select || !info) return;
  const [project, folder] = select.value.split("/");
  const match = targets().find((t) => t.project === project && t.specFolder === folder);
  info.innerHTML = match ? summary(match) : "";
}

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
// better things to do than answer a closed laptop.
function tick(): void {
  if (document.visibilityState === "visible") void swapRows();
}

document.getElementById("target")?.addEventListener("change", showSelection);
document.addEventListener("visibilitychange", tick);
setInterval(tick, REFRESH_MS);
showSelection();
