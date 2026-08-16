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
  done?: string[];
}

const STEP_ORDER = ["analyze", "review-plan", "implement", "archive"];

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

// The step boxes belong to the SPEC, not to the page: switching to a
// spec that has already been analysed must not leave "analyze" ticked.
function showSteps(target: QueueTarget | undefined): void {
  const done = new Set(target?.done ?? []);
  const next = STEP_ORDER.find((s) => !done.has(s));
  for (const label of Array.from(document.querySelectorAll<HTMLLabelElement>("#steps .stepbox"))) {
    const step = label.dataset.step;
    if (!step) continue;
    const box = label.querySelector<HTMLInputElement>("input");
    const isDone = done.has(step);
    label.classList.toggle("isdone", isDone);
    label.querySelector(".tick")?.remove();
    if (isDone) {
      const tick = document.createElement("span");
      tick.className = "tick";
      tick.title = "already done";
      tick.textContent = "✓";
      label.append(" ", tick);
    }
    if (box) box.checked = step === next;
  }
}

// The spec's own project is already watched, so offering to add it
// again is an error waiting to be submitted.
function showExtraProjects(project: string | undefined): void {
  for (const label of Array.from(document.querySelectorAll<HTMLLabelElement>("#extraprojects .stepbox"))) {
    const box = label.querySelector<HTMLInputElement>("input");
    if (!box) continue;
    const isOwn = label.dataset.project === project;
    box.disabled = isOwn;
    if (isOwn) box.checked = false;
    label.classList.toggle("isdone", isOwn);
  }
}

function showSelection(): void {
  const select = document.getElementById("target") as HTMLSelectElement | null;
  const info = document.getElementById("specinfo");
  if (!select || !info) return;
  const [project, folder] = select.value.split("/");
  const match = targets().find((t) => t.project === project && t.specFolder === folder);
  info.innerHTML = match ? summary(match) : "";
  showSteps(match);
  showExtraProjects(project);
}

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
    const res = await fetch(`/queue?${params}`, { headers: { accept: "text/html" } });
    if (!res.ok) return; // a blip is not worth a broken page
    body.innerHTML = await res.text();
  } catch {
    // offline, server restarting, tailnet hiccup: try again next tick
  }
}

// A filter link is a real link and works without this. Intercepting it
// keeps the promise the rest of this file makes: never reload the page
// under a form somebody is half-way through filling in.
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

document.getElementById("target")?.addEventListener("change", showSelection);
// Delegated from the container, because the controls are replaced along
// with the rows on every tick — a listener on the links themselves
// would last five seconds.
document.getElementById("jobrows")?.addEventListener("click", navigate as EventListener);
document.addEventListener("visibilitychange", tick);
setInterval(tick, REFRESH_MS);
showSelection();
