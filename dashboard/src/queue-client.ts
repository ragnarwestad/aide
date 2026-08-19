// The spec list's browser code. TypeScript like the rest of the
// repo — `tsc --noEmit` covers it, and the server transpiles it on the
// way out.
//
// One rule, applied twice: never reload the page under a control
// someone is half-way through setting. That is why the table refreshes
// itself in place, and why every button on it posts from here rather
// than letting the browser navigate.
//
// It used to have a second — answering the spec dropdown above the
// table, which had to update the step boxes, the "also touches" list
// and a summary line whenever the selection changed. Every spec has its
// own row-scoped control now, rendered by the server, so there is no
// selection left to react to and none of that code has a caller.

const REFRESH_MS = 5000;
/** Presses whose request has not answered yet. The tick waits for zero. */
let inFlight = 0;

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
    const res = await fetch(`/?${params}`, { headers: { accept: "text/html" } });
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

// What happened AFTER the merge landed: whatever the install did (or
// that there was none to run), and whether the spec branch was actually
// removed from origin. Merged is not deployed — the default branch
// moving changes nothing on the machine until the install runs — and a
// branch left on origin is what spec 92's dependency guard reads as
// "not merged yet". Both are said out loud, in the same banner a
// refusal already uses. It sits OUTSIDE #jobrows on purpose: it is
// about what just happened, not about any row, and the five-second swap
// must not wipe it.
function afterMergeNote(text: string): void {
  const rows = document.getElementById("jobrows");
  document.getElementById("installnote")?.remove();
  if (!text || !rows?.parentNode) return;
  const note = document.createElement("p");
  note.id = "installnote";
  // `refusal` is the selector hook and carries no look of its own;
  // `rowmsg err` is the component that gives it one. Both, because
  // neither does the other's job.
  note.className = "refusal rowmsg err";
  note.textContent = text;
  rows.parentNode.insertBefore(note, rows);
}

// Every control on this page used to be a plain form POST: the browser
// navigated on the click, so the button froze mid-navigation with
// nothing to say for itself, and the 303 landed on a page whose render
// asks git once per spec — several seconds later, at the top of the
// list, away from the row the reader was watching. Merge was fixed
// first (spec 96); spec 101 gave Run, Approve, Cancel and Create the
// same treatment and took the navigation out of the REFUSAL path too.
//
// Same request, same route, same answer; only the waiting and the jump
// are gone. Everything here degrades: without this file the forms still
// submit themselves and the 303 still works, which is why the markup
// stays a real form rather than a button this code has to give meaning
// to.

/** Every form in `#jobrows` this file speaks for. They differ in what
 *  they ask the server, not in what pressing them should look like. */
const ACTIONS = "form.rowrun, form.actionform, form.mergeform";

interface ActionResult {
  ok?: boolean;
  spec?: string;
  error?: string;
  results?: { error?: string; installError?: string; branchDeleteError?: string }[];
}

/** Why the server said no, whichever shape it said it in: merge answers
 *  per repo, the other four answer once. */
function refusalText(body: ActionResult | null): string {
  const perRepo = (body?.results ?? []).map((r) => r.error).filter(Boolean).join("; ");
  return perRepo || body?.error || "the request failed";
}

/** Post a form as JSON-wanting XHR and hand the answer on. The button
 *  work is the same for all five controls, and is the whole point: a
 *  press has to change something the instant it happens.
 *
 *  The form's own fields go with it. Merge needs none — but Run IS its
 *  fields (the phases ticked, the model, the other repos, the gate), and
 *  the hidden view fields are what the server rebuilds the reader's
 *  filter from on the no-JS path. */
async function postForm(
  form: HTMLFormElement,
  onOk: (body: ActionResult | null) => Promise<void> | void,
  onRefused: (why: string, spec: string | undefined) => Promise<void> | void,
): Promise<void> {
  const buttons = Array.from(form.querySelectorAll("button"));
  const primary = buttons[0];
  const label = primary?.textContent ?? "";
  for (const b of buttons) b.disabled = true;
  inFlight += 1;
  // SOMETHING has to change the moment it is pressed. The work behind
  // these buttons takes seconds, and a button that looks untouched for
  // that long reads as a button that did not register the click. What
  // it says while it waits is the server's word, in the markup
  // (`data-pending`), beside the label it replaces.
  if (primary) primary.textContent = primary.dataset?.pending || "working…";
  try {
    // The token rides in the query string, as it does for a bookmarked
    // page: the guard reads a header, the query string or the cookie,
    // and never the form body.
    const url = new URL(form.action, location.href);
    const token = form.querySelector('input[name="token"]') as HTMLInputElement | null;
    if (token?.value) url.searchParams.set("token", token.value);
    const body = new URLSearchParams();
    new FormData(form).forEach((value, key) => {
      if (typeof value === "string") body.append(key, value);
    });
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const answer = (await res.json().catch(() => null)) as ActionResult | null;
    if (res.ok && answer?.ok) {
      await onOk(answer);
      return;
    }
    await onRefused(refusalText(answer), answer?.spec);
  } catch {
    // Offline, or the server restarting mid-request: the page reload is
    // the always-correct answer, because it asks the server again. With
    // the reader's own query string — the sort and the filter live
    // there, and a bare `/` threw them away.
    location.href = `/${location.search}`;
  } finally {
    inFlight -= 1;
    // `isConnected` because a successful swapRows has already replaced
    // this form with a fresh one from the server.
    if (primary?.isConnected) primary.textContent = label;
    for (const b of buttons) if (b.isConnected) b.disabled = false;
  }
}

// A refusal used to navigate — and take the reader's view with it. It
// does not any more: the address bar is moved WITHOUT a document load,
// and the rows are re-asked with the same query the server's own
// redirect would have built. The filter and the sort live in that query,
// so they are read straight back out of it; dropping them would put
// every refusal back on the default list, which is the thing the plain
// form POST was fixed for. `errorSpec` is the server's own answer for
// WHICH row this belongs to, and `specHeadRow` puts it there.
async function showRefusal(why: string, spec: string | undefined): Promise<void> {
  const back = new URLSearchParams(location.search);
  // Handed over once as a cookie: putting it back in the address bar
  // would leave the token in history for nothing. `rows` and the two
  // this is about to set would otherwise be carried over from a URL
  // that is already showing a refusal.
  for (const drop of ["token", "rows", "error", "errorSpec"]) back.delete(drop);
  // Percent-encoded one key at a time, exactly as the server's own
  // redirect does it (`specsRedirect`): `URLSearchParams.toString()`
  // writes a space as `+`, and this string is a sentence a person reads
  // off the page it lands on.
  const parts = [...back].map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  parts.push(`error=${encodeURIComponent(why)}`);
  if (spec) parts.push(`errorSpec=${encodeURIComponent(spec)}`);
  history.replaceState(null, "", `/?${parts.join("&")}`);
  await swapRows();
}

async function submitAction(event: Event): Promise<void> {
  // A form that cancelled its own submit (an `onsubmit` that returned
  // false) is not ours to post.
  if (event.defaultPrevented) return;
  const form = (event.target as Element | null)?.closest?.(ACTIONS) as HTMLFormElement | null;
  if (!form) return;
  event.preventDefault();
  await postForm(
    form,
    async (body) => {
      // Now, not on the next five-second tick: the result belongs where
      // the reader already is.
      await swapRows();
      // Only a merge reports per repo, and only a merge has anything to
      // say after the fact. Another action's success must not wipe the
      // note a merge just left.
      if (body?.results) {
        afterMergeNote(
          body.results.flatMap((r) => [r.installError, r.branchDeleteError]).filter(Boolean).join("; "),
        );
      }
    },
    showRefusal,
  );
}

// The New-spec form is the one control that is NOT about a spec that
// exists, and it is bound directly rather than by delegation because it
// sits OUTSIDE #jobrows on purpose — a half-typed description must
// survive the five-second swap.
//
// Its refusal has no row to land on: the spec it named was never made,
// so the server has no `errorSpec` to give and never will. The reason
// goes beside the form that was refused instead — where the reader is
// still looking, and not in a banner above a disclosure that may well
// be shut.
function formNote(form: HTMLFormElement, text: string): void {
  const slot = form.querySelector(".refused");
  if (slot) slot.textContent = text;
}

async function submitCreate(form: HTMLFormElement, event: Event): Promise<void> {
  if (event.defaultPrevented) return;
  event.preventDefault();
  await postForm(
    form,
    async () => {
      formNote(form, "");
      form.reset?.();
      // Shut again: the spec it made is a row on the list now, which is
      // what the reader wants to see.
      const panel = form.closest?.("details") as HTMLDetailsElement | null;
      if (panel) panel.open = false;
      await swapRows();
    },
    (why) => formNote(form, why),
  );
}

// Pause while the tab is hidden: nobody is reading, and the mini has
// better things to do than answer a closed laptop. And pause while a
// press is in flight: the server still shows the OLD state until it
// answers, so a swap in that window would put an untouched button back
// over the "merging…" the press just showed — the click looked
// unregistered, and then the row jumped.
function tick(): void {
  if (document.visibilityState === "visible" && inFlight === 0) void swapRows();
}

// Delegated from the container, because the controls are replaced along
// with the rows on every tick — a listener on the links themselves
// would last five seconds.
document.getElementById("jobrows")?.addEventListener("click", navigate as EventListener);
document.getElementById("jobrows")?.addEventListener("submit", submitAction as EventListener);
// The one listener that is NOT delegated: this form sits outside
// #jobrows so the swap cannot wipe what someone is typing into it.
// The handler's promise is returned rather than dropped — a listener's
// return value is ignored by the DOM, and it is what lets the test wait
// for the request the press makes.
const newSpec = document.querySelector("form.newspecform") as HTMLFormElement | null;
newSpec?.addEventListener("submit", ((event: Event) => submitCreate(newSpec, event)) as EventListener);
document.addEventListener("visibilitychange", tick);
setInterval(tick, REFRESH_MS);
