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

// Merged is not deployed. For a project that installs itself, the
// default branch moving changes nothing on the machine until the
// install runs — so whatever the install did (or that there was none to
// run) is said out loud, in the same banner a refusal already uses. It
// sits OUTSIDE #jobrows on purpose: it is about what just happened, not
// about any row, and the five-second swap must not wipe it.
function installNote(text: string): void {
  const rows = document.getElementById("jobrows");
  document.getElementById("installnote")?.remove();
  if (!text || !rows?.parentNode) return;
  const note = document.createElement("p");
  note.id = "installnote";
  note.className = "refusal";
  note.textContent = text;
  rows.parentNode.insertBefore(note, rows);
}

// Merging used to be a plain form POST: the browser sat on it for
// several seconds with nothing changing on the button, then followed a
// 303 back to /specs and reloaded — so the page jumped to the top, away
// from the row the reader was watching. Same request, same route, same
// answer; only the waiting and the jump are gone.
//
// Everything here degrades: without this file the forms still submit
// themselves and the 303 still works, which is why the markup stays a
// real form rather than a button this code has to give meaning to.
async function submitMerge(event: Event): Promise<void> {
  // The override form asks `confirm()` from its own onsubmit, which runs
  // BEFORE this delegated one and cancels the event when the answer is
  // no. Without this line, cancelling the dialog would merge anyway —
  // the exact opposite of what the dialog is for.
  if (event.defaultPrevented) return;
  const form = (event.target as Element | null)?.closest?.(
    "form.mergeform, form.mergeoverride",
  ) as HTMLFormElement | null;
  if (!form) return;
  event.preventDefault();
  const buttons = Array.from(form.querySelectorAll("button"));
  const primary = buttons[0];
  const label = primary?.textContent ?? "";
  for (const b of buttons) b.disabled = true;
  // SOMETHING has to change the moment it is pressed. The merge itself
  // takes seconds, and a button that looks untouched for that long
  // reads as a button that did not register the click.
  if (primary) primary.textContent = "merging…";
  try {
    // The token rides in the query string, as it does for a bookmarked
    // page: the guard reads a header, the query string or the cookie,
    // and never the form body.
    const url = new URL(form.action, location.href);
    const token = form.querySelector('input[name="token"]') as HTMLInputElement | null;
    if (token?.value) url.searchParams.set("token", token.value);
    const res = await fetch(url.toString(), { method: "POST", headers: { accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; results?: { error?: string; installError?: string }[] }
      | null;
    if (res.ok && body?.ok) {
      // Now, not on the next five-second tick: the result belongs where
      // the reader already is.
      await swapRows();
      installNote((body.results ?? []).map((r) => r.installError).filter(Boolean).join("; "));
      return;
    }
    // A refusal is rare and already has a way of reporting itself — the
    // banner outside #jobrows, which swapRows deliberately never
    // touches. Reusing it costs the "no jump" property on the failure
    // branch alone, which is not the case anyone complained about.
    const why = (body?.results ?? []).map((r) => r.error).filter(Boolean).join("; ");
    location.href = `/specs?error=${encodeURIComponent(why || "the merge failed")}`;
  } catch {
    // Offline, or the server restarting mid-merge: the page reload is
    // the always-correct answer, because it asks git again.
    location.href = "/specs";
  } finally {
    // `isConnected` because a successful swapRows has already replaced
    // this form with a fresh one from the server.
    if (primary?.isConnected) primary.textContent = label;
    for (const b of buttons) if (b.isConnected) b.disabled = false;
  }
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
document.getElementById("jobrows")?.addEventListener("submit", submitMerge as EventListener);
document.addEventListener("visibilitychange", tick);
setInterval(tick, REFRESH_MS);
