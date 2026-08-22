// The spec list's browser code. TypeScript like the rest of the
// repo — `tsc --noEmit` covers it, and the server transpiles it on the
// way out.
//
// One rule, applied twice: never reload the page under a control
// someone is half-way through setting. That is why the table refreshes
// itself in place, and why every button on it posts from here rather
// than letting the browser navigate. Create is the one deliberate
// exception, and it is not one of "the buttons on it": it is on a page
// of its own with nothing to keep (spec 121, see `submitCreate`).
//
// It used to have a second — answering the spec dropdown above the
// table, which had to update the step boxes, the "also touches" list
// and a summary line whenever the selection changed. Every spec has its
// own row-scoped control now, rendered by the server, so there is no
// selection left to react to and none of that code has a caller.

const REFRESH_MS = 5000;
/** The New-spec form, and never the Add-project one. Both wear
 *  `newspecform` — the Add form borrows the look — and the two live on
 *  different pages: the real one is the whole of `/new` (spec 121),
 *  and `/projects` has only the Add form, which would otherwise answer
 *  in its place — bound twice, two POSTs for one press. */
const NEW_SPEC_FORM = "form.newspecform:not(.addprojectform)";
/** Presses whose request has not answered yet. The tick waits for zero. */
let inFlight = 0;
/** Bumped the instant a press BEGINS. `swapRows` reads it before its own
 *  fetch and again after, and drops the answer if it moved.
 *
 *  `inFlight` is only half the guard: it stops a NEW swap from starting
 *  mid-press, and says nothing about one that was already in the air
 *  when the press began. That one carries the server's answer from
 *  BEFORE the press, and used to write it into #jobrows over the busy
 *  button — or over the refusal banner — whenever it finally resolved.
 *  A `/?rows=1` answer waits on `isMerged` for every branch of every
 *  listed job, and a cache miss there costs up to three git calls at
 *  four seconds each, so the window is ten seconds wide and more: it is
 *  the 10-15 seconds of a Merge button sitting unchanged that was
 *  measured on 2026-08-20. */
let pressGen = 0;

/** Every select on the rows a PERSON has moved, keyed by the form it
 *  names and its own name. Reported 2026-08-20: pick Codex on a row,
 *  and five seconds later the select is back on Claude Code.
 *
 *  The rows are replaced wholesale on every tick, and the fresh markup
 *  is the server's answer: every phase select back on the CONFIGURED
 *  model rather than the one just picked. Nothing about that is
 *  visible in the moment it happens. The cost is the press afterwards:
 *  a row asked for Codex, left alone for six seconds and then Run,
 *  started the step on Claude without a word.
 *
 *  Only hand-made choices are kept. A select nobody touched belongs to
 *  the server — that is how a phase that has run shows the model it
 *  really ran on — so this map stays empty until somebody changes
 *  something, and the swap behaves exactly as it did before. */
const chosen = new Map<string, string>();

const selectKey = (el: HTMLSelectElement): string => `${el.getAttribute("form") ?? ""}|${el.name}`;

/** The same promise for the row's PHASE BOXES, which the select fix
 *  above left out — and they are the half a press actually runs.
 *  Reported 2026-08-20: tick implement and archive, wait six seconds,
 *  press Run, and the job started whatever the SERVER had ticked. The
 *  server re-derives the ticks from the spec's own history on every
 *  render (`preTicked`), so a swap does not leave them alone; it
 *  overwrites them.
 *
 *  Keyed on THREE parts, where a select needs two: every box on a row
 *  shares the one name `steps`, and only its value says which phase it
 *  is. A two-part key would file all of them together and let the last
 *  box touched answer for the row.
 *
 *  Same rule as the selects: only a box a hand moved is kept, and a
 *  hand-made "off" is kept exactly as a hand-made "on" is. */
const chosenSteps = new Map<string, boolean>();

const checkboxKey = (el: HTMLInputElement): string =>
  `${el.getAttribute("form") ?? ""}|${el.name}|${el.value}`;

/** Put the hand-made choices back on the rows that were just drawn.
 *
 *  A remembered model is only put back if the fresh markup still offers
 *  it: a value no option carries is not a choice the row can honour.
 *  There is nothing to restore ahead of it any more — the row's AI
 *  select went in spec 169, and with it the filter that used to move a
 *  selection of its own on the way past. */
/** The row's button says what a press would run — and a press runs the
 *  BOXES, so the label has to follow them as they are clicked.
 *
 *  The server names the button from `preTicked`, which is its own
 *  suggestion (`queue-list.ts`). That is right for the row as drawn and
 *  wrong the instant a reader ticks something else: on 2026-08-21 a spec
 *  whose analyze was suggested, with only `archive` ticked by hand, went
 *  on offering "Analyze". The press was correct — an open row posts its
 *  boxes and no hidden steps — but the row said one thing and did
 *  another, which is the whole thing naming the button was for.
 *
 *  The display name comes off the box's own `aria-label`, which the
 *  server already sets to the phase's reader-facing name ("review" for
 *  `review-plan`), so the step-label table is not spelled a second time
 *  in the browser.
 *
 *  Nothing ticked hides the button, as the server's own render does: a
 *  press that can do nothing must not be offered. Without this file the
 *  label simply stays as rendered, which is the same honest fallback
 *  every other thing here degrades to. */
function relabelRunButton(body: Element, formId: string): void {
  // Quoted, so only a quote or a backslash could break out — and a form
  // id is `rowrun-<project>/<folder>`, both of which the route's own
  // regex limits to letters, digits, dot, dash and underscore. Escaped
  // anyway, and by hand: `CSS.escape` is a browser API the test harness
  // does not have (`ReferenceError: CSS is not defined`), and this file
  // is transpiled and run there.
  const selector = `[form="${formId.replace(/["\\]/g, "\\$&")}"]`;
  // `querySelectorAll`, not `querySelector`: the harness's `#jobrows`
  // stub offers the plural and not the singular, and the two answer the
  // same question here — a form id names one button.
  const button = body.querySelectorAll(`button${selector}`)[0] as HTMLButtonElement | undefined;
  if (!button) return;
  // The BOXES and the BUTTON are tied by the form they name, not by the
  // row they sit in: a phase box is on a sub-row of its own and the
  // button is up in the head row's State cell, so no walk from one to
  // the other is as reliable as the id both already carry.
  const boxes = Array.from(body.querySelectorAll(`input[name="steps"]${selector}`)) as HTMLInputElement[];
  const first = boxes.find((b) => b.checked);
  if (!first) {
    button.hidden = true;
    return;
  }
  button.hidden = false;
  const name = first.getAttribute("aria-label") ?? first.value;
  button.textContent = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** Every open row's button, after a redraw put the server's own label
 *  back over a reader's ticks. A row with no phase boxes on the page —
 *  every shut one — is left alone: its label is the server's and there
 *  is nothing on screen to disagree with it. */
function relabelAll(body: Element): void {
  const seen = new Set<string>();
  for (const el of body.querySelectorAll('input[name="steps"][form]')) {
    const id = el.getAttribute("form");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    relabelRunButton(body, id);
  }
}

function restoreChosen(body: Element): void {
  if (!chosen.size && !chosenSteps.size) return;
  for (const el of body.querySelectorAll('select[name^="model."]')) {
    const model = el as HTMLSelectElement;
    const want = chosen.get(selectKey(model));
    if (want === undefined) continue;
    for (const option of model.options) {
      if (option.value === want) model.value = want;
    }
    // The AI select this swap just redrew was drawn for the model the
    // SERVER chose, and the line above has put another one back over
    // it. It carries no memory of its own — it is set from the model,
    // every time, which is what stops the two disagreeing (spec 179).
    syncAiToModel(model);
  }
  for (const el of body.querySelectorAll('input[name="steps"]')) {
    const box = el as HTMLInputElement;
    const want = chosenSteps.get(checkboxKey(box));
    if (want === undefined) continue;
    box.checked = want;
  }
  // After the ticks, never before: the label is read off them.
  relabelAll(body);
}

// The filter and the sort live in the address bar, so the refresh has
// to ask for the same list the reader is looking at — otherwise every
// tick would quietly throw the filter away.
async function swapRows(): Promise<void> {
  const body = document.getElementById("jobrows");
  if (!body) return;
  const gen = pressGen;
  const params = new URLSearchParams(location.search);
  params.delete("token");
  params.set("rows", "1");
  try {
    const res = await fetch(`/?${params}`, { headers: { accept: "text/html" } });
    if (!res.ok) return; // a blip is not worth a broken page
    const html = await res.text();
    // A press began while this was in the air, so this answer predates
    // it and is not the page's current one. The press's own follow-up
    // swap, or the next tick, supplies that within five seconds; what
    // must not happen is this one landing on top of what the press just
    // drew.
    if (pressGen !== gen) return;
    body.innerHTML = html;
    restoreChosen(body);
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

// Every control on this page used to be a plain form POST: the browser
// navigated on the click, so the button froze mid-navigation with
// nothing to say for itself, and the 303 landed on a page whose render
// asks git once per spec — several seconds later, at the top of the
// list, away from the row the reader was watching. Merge was fixed
// first (spec 96); spec 101 gave Run, Cancel and Create the same
// treatment and took the navigation out of the REFUSAL path too.
//
// Same request, same route, same answer; only the waiting and the jump
// are gone. Everything here degrades: without this file the forms still
// submit themselves and the 303 still works, which is why the markup
// stays a real form rather than a button this code has to give meaning
// to.

/** Every form in `#jobrows` this file speaks for. They differ in what
 *  they ask the server, not in what pressing them should look like. */
const ACTIONS = "form.rowrun, form.actionform";

/** Character for character what `components.ts` renders (`SPINNER`).
 *  This file can neither import nor export, so the one thing keeping
 *  the two equal is a test that reads both (`queue-client.test.ts`).
 *  Change one and change the other. */
const SPINNER = `<span class="spin" aria-hidden="true"></span>`;

/** The looks a button can arrive in. `busy` goes IN PLACE of whichever
 *  one it has, the same swap `btn()` makes server-side for a job
 *  already in flight — two variants at once is a button with two
 *  looks. */
const VARIANTS = ["primary", "ok", "danger"];

interface ActionResult {
  ok?: boolean;
  spec?: string;
  error?: string;
  /** The project routes answer step by step (`answerProjectChange`), so
   *  a refusal can name WHICH step refused. The merge route answered in
   *  the same shape, per repo, until spec 149 removed it. */
  results?: { error?: string }[];
  /** An Add that SUCCEEDED and still has something to say: whether a
   *  run can start in the project it just registered (spec 138). The
   *  server writes the sentence — the same one its own redirect carries
   *  for a browser with no script — so there is one wording, not two. */
  readiness?: { canRun?: boolean; note?: string };
}

/** Why the server said no, whichever shape it said it in: the project
 *  routes answer per step, the queue routes answer once. */
function refusalText(body: ActionResult | null): string {
  const perStep = (body?.results ?? []).map((r) => r.error).filter(Boolean).join("; ");
  return perStep || body?.error || "the request failed";
}

/** A value quoted inside an attribute selector. The ids it is used on
 *  are `rowrun-<project>/<specFolder>`, which needs no escaping at all
 *  — but a quote in a folder name would end the selector early, and
 *  that is a page that throws rather than a lookup that misses. */
const attrValue = (v: string): string => v.replace(/["\\]/g, "\\$&");

/** Everything written OUTSIDE a form and tied to it by name alone. On
 *  a spec's row that is the Run button, the four phase boxes, the five
 *  model selects and the five AI selects: the trick spec 123 introduced so
 *  the button could sit above the phase lines and the boxes on them,
 *  while the form itself carries nothing but hidden fields. */
const namesForm = (id: string): Element[] =>
  id ? Array.from(document.querySelectorAll(`[form="${attrValue(id)}"]`)) : [];

type Control = HTMLButtonElement | HTMLInputElement | HTMLSelectElement;

/** Every control a press has to lock — which is every control on the
 *  ROW, not the submitted form's own.
 *
 *  Both halves of that are the fix for what was seen on 2026-08-21:
 *  Run was pressed, nothing changed, so it was pressed again, and the
 *  second press was refused because the first had already started the
 *  job.
 *
 *  `form.querySelectorAll("button")` is scoped to DESCENDANTS, and the
 *  Run button is not one: it is written after its form's closing tag
 *  and reaches it by `form="…"`. So for the run form that lookup found
 *  nothing — no spinner, no busy look, and the button never disabled.
 *  And even where it did find the pressed button (Cancel, Resolve),
 *  everything else on the row stayed live for the whole round-trip,
 *  so a second press could land on a different control of the same
 *  row.
 *
 *  The HEAD row is the row's own container — the one `<tr>` every spec
 *  has, open or shut — and the form-attribute lookup reaches what sits
 *  outside it on the phase lines. It was the stack cell until spec 157
 *  moved the row's one button into the State column and deleted that
 *  cell; the head row is where a control lives now whether the row is
 *  open or shut, which the stack cell never was (a shut row had none).
 *  The ids carry the spec's own key, so this reaches one row and never
 *  a neighbour. */
function rowControls(form: HTMLFormElement): Control[] {
  const head = form.closest("tr.spechead");
  // A form that is not on a spec's row at all — the New-spec page, the
  // Projects panel. Its own button is inside it, and there is nothing
  // to widen the scope to.
  if (!head) return Array.from(form.querySelectorAll("button"));
  const runForm = head.querySelector("form.rowrun") as HTMLFormElement | null;
  // Hidden fields are left out: they are not controls anybody can
  // press, and the row's whole point is what a person can still do to
  // it.
  const inHead = Array.from(head.querySelectorAll("button, select, input:not([type=hidden])"));
  // The Run button answers both lookups — it is in the head row AND
  // names the run form — so the two are deduplicated rather than left
  // to disable it twice.
  return [...new Set([...inHead, ...namesForm(runForm?.id ?? "")])] as Control[];
}

/** Post a form as JSON-wanting XHR and hand the answer on. The button
 *  work is the same for every control, and is the whole point: a press
 *  has to change something the instant it happens.
 *
 *  The form's own fields go with it. Cancel needs none — but Run IS its
 *  fields (the phases ticked, the model, the other repos), and
 *  the hidden view fields are what the server rebuilds the reader's
 *  filter from on the no-JS path. */
async function postForm(
  form: HTMLFormElement,
  onOk: (body: ActionResult | null) => Promise<void> | void,
  onRefused: (why: string, spec: string | undefined) => Promise<void> | void,
): Promise<void> {
  const controls = rowControls(form);
  // The busy LOOK belongs to the button that was pressed, so it is read
  // off the submitted form alone and never off the row: Run is first in
  // the stack, and a button taken from there would wear the spinner for
  // every press that was not Run's. The run form's own button is the
  // one outside its tags that names it.
  const own = Array.from(form.querySelectorAll("button"));
  const primary =
    own[0] ?? (namesForm(form.id).find((el) => el.tagName === "BUTTON") as HTMLButtonElement | undefined);
  const label = primary?.textContent ?? "";
  const titleBefore = primary?.title ?? "";
  // A form on a spec's row, or the New-spec form above the table: the
  // two say they were pressed in different ways, and this is the only
  // question asked about where the form is.
  const row = form.closest("tr");
  const variant = VARIANTS.find((v) => primary?.classList.contains(v));
  /** What each control was BEFORE the press, so it can be put back to
   *  that and not to "live". A row's controls are not uniformly live:
   *  the server draws Cancel and the phase boxes disabled while a job
   *  holds them, and re-enabling those would offer a choice the server
   *  has already refused. */
  const before = controls.map((el) => [el, el.disabled] as const);
  inFlight += 1;
  pressGen += 1;
  // SOMETHING has to change the moment it is pressed. The work behind
  // these buttons takes seconds, and a button that looks untouched for
  // that long reads as a button that did not register the click.
  //
  // What changes is the LOOK, not the word: a button that swapped "Run"
  // for "starting…" grew to fit and took the whole row with it, at the
  // one moment it should look most in control (spec 104). So it goes
  // busy — the same variant the server renders for a job already in
  // flight — and the server's own pending word (`data-pending`) moves
  // to the `title`, where it costs no width. The spinner goes inside
  // the button, where it costs no width either.
  //
  // It used to be put where the row's phase boxes were instead, and
  // borrow their width. Those boxes are on the phase LINES since spec
  // 124 — a different `<tr>` from the button — and the only `.phases`
  // group left in a button's own row is "also touches", which is not
  // the row's spinner to take. One rule now, for every control alike:
  // the button that was pressed carries it.
  const pressed = (): void => {
    // The lock is the whole row's, and it happens HERE rather than
    // before the fetch is prepared: a disabled control posts nothing,
    // so locking the phase boxes ahead of `new FormData(form)` would
    // queue a job with none of the phases that were ticked. Nothing is
    // painted between the two, so the row is locked in the same beat
    // the click lands in either way.
    for (const el of controls) el.disabled = true;
    if (!primary) return;
    if (!row) {
      // The New-spec form: no row to shove, no boxes to lend. It keeps
      // the word swap it has always had.
      primary.textContent = primary.dataset?.pending || "working…";
      return;
    }
    if (variant) primary.classList.remove(variant);
    primary.classList.add("busy");
    primary.title = primary.dataset?.pending || titleBefore;
    // ONE spinner per press, before the label and inside the button —
    // which is where a collapsed row's Merge has always put it.
    primary.insertAdjacentHTML("afterbegin", SPINNER);
  };
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
    pressed();
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
    // there, and a bare `/` threw them away. And with the reader's own
    // PATH: this code runs on `/projects` too since spec 115.
    location.href = location.pathname + location.search;
  } finally {
    inFlight -= 1;
    // `isConnected` because a successful swapRows has already replaced
    // this form with a fresh one from the server. What is put back here
    // is for the case it did not: the row the reader is looking at must
    // not be left holding a spinner for something that is over.
    // `textContent` takes the spinner out with it — it replaces every
    // child.
    if (primary?.isConnected) {
      primary.textContent = label;
      primary.title = titleBefore;
      primary.classList.remove("busy");
      if (variant) primary.classList.add(variant);
    }
    // Only what is still standing. A successful swap has replaced the
    // whole row with the server's own answer, and that markup already
    // says which of these are live — putting the old elements back
    // would be answering for a row that is gone.
    for (const [el, was] of before) if (el.isConnected) el.disabled = was;
  }
}

/** A phase box that posts itself (spec 160). While a job runs, the
 *  boxes for phases it has not reached stay live — and there is nothing
 *  to submit them with: a busy row draws Cancel where Run would be, and
 *  posting to `/api/queue` would ask for a second job the queue refuses
 *  as a clash. So the tick IS the press, and it goes straight to the
 *  running job's own route.
 *
 *  Everything else about it is the shape every other press already has
 *  (`postForm`): the whole row locks the instant the tick lands, the
 *  row is redrawn from the server's own answer, and a refusal lands
 *  beside the row rather than navigating. The one thing a checkbox
 *  cannot borrow is the busy LOOK — it has no button to carry a
 *  spinner, and the chip's own `busy` style hides the input, so the
 *  lock is what says the tick registered.
 *
 *  The row is reached through the form the box names — the same id
 *  every control written outside that form carries — which is also
 *  where the token is. */
async function postTailStep(box: HTMLInputElement): Promise<void> {
  const to = box.getAttribute("data-post-to") ?? "";
  const formId = box.getAttribute("form") ?? "";
  const form = formId
    ? (document.querySelector(`form[id="${attrValue(formId)}"]`) as HTMLFormElement | null)
    : null;
  const controls = form ? rowControls(form) : [box as Control];
  const wanted = box.checked;
  const before = controls.map((el) => [el, el.disabled] as const);
  inFlight += 1;
  pressGen += 1;
  for (const el of controls) el.disabled = true;
  try {
    const url = new URL(to, location.href);
    const token = form?.querySelector('input[name="token"]') as HTMLInputElement | null;
    if (token?.value) url.searchParams.set("token", token.value);
    const body = new URLSearchParams();
    body.append("step", box.value);
    body.append("checked", wanted ? "1" : "0");
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const answer = (await res.json().catch(() => null)) as ActionResult | null;
    if (res.ok && answer?.ok) {
      await swapRows();
      return;
    }
    // Put the tick back BEFORE the refusal is shown: the swap that
    // follows redraws the box from the server anyway, and a swap that
    // never comes must not leave the box claiming an edit that did not
    // take.
    if (box.isConnected) box.checked = !wanted;
    await showRefusal(refusalText(answer), answer?.spec);
  } catch {
    location.href = location.pathname + location.search;
  } finally {
    inFlight -= 1;
    for (const [el, was] of before) if (el.isConnected) el.disabled = was;
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
    async () => {
      // Now, not on the next five-second tick: the result belongs where
      // the reader already is.
      await swapRows();
    },
    showRefusal,
  );
}

// The New-spec form is the one control that is NOT about a spec that
// exists, and it is bound directly rather than by delegation: it is
// the whole of its own page (spec 121), with no #jobrows around it for
// a delegated listener to hang off.
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

// A dependency is resolved inside ONE specs root — `aide-run-spec`
// checks every "Depends on:" entry against the chosen project's own —
// so a chip belonging to another project is not a choice anyone can
// make. The server refuses it either way; this is the half that means
// nobody has to be refused to find out.
//
// Hidden AND disabled, and unticked on the way out: a disabled box posts
// nothing, but a box that stays ticked while out of sight is a choice
// the reader can no longer see they are making.
function syncDependsOn(): void {
  const form = document.querySelector(NEW_SPEC_FORM);
  if (!form) return;
  const select = form.querySelector("select[name=project]") as HTMLSelectElement | null;
  if (!select) return;
  for (const wrap of form.querySelectorAll("[data-project]")) {
    const el = wrap as HTMLElement;
    const mine = el.getAttribute("data-project") === select.value;
    el.hidden = !mine;
    const box = el.querySelector("input") as HTMLInputElement | null;
    if (!box) continue;
    box.disabled = !mine;
    if (!mine) box.checked = false;
  }
}

// The AI picked on ONE phase line, written into that line's own model
// select (spec 179). One phase, never the row: the control it replaced
// set every phase at once, and a picker that sits on a line is a
// statement about that line.
//
// Scoped by FORM ID and `data-ai` together, not by walking the row: the
// model selects are written outside their form's own tags and tied to
// it by that attribute alone, so the row is not a container that holds
// them. `data-ai` carries the paired select's `name` — the same name it
// posts under.
//
// The value written is the one the SERVER worked out and put on the
// option. Which model an AI stands for is a configuration fact
// (`defaultModelForTool`, `queue-list.ts`), so the browser copies it
// and never chooses between a tool's models itself.
//
// The write is recorded in `chosen` as well. Setting `.value` from
// script fires no `change` event, so the delegated listener that
// normally remembers a hand-made choice never sees this one — and
// without the record the five-second swap would put the server's markup
// back over the phase this just set, with a press afterwards starting
// the step on a model nobody chose.
//
// Nothing is done to the AI select itself: the browser has already left
// it on the option the reader picked, and a swap puts it back from the
// model select rather than from a memory of its own (`syncAiToModel`).
function applyAiPick(select: HTMLSelectElement): void {
  const form = select.getAttribute("form");
  const name = select.getAttribute("data-ai");
  const want = select.selectedOptions[0]?.dataset.default;
  if (!form || !name || !want) return;
  const model = document.querySelectorAll(
    `select[name="${name}"][form="${form}"]`,
  )[0] as HTMLSelectElement | undefined;
  if (!model) return;
  for (const option of model.options) {
    if (option.value !== want) continue;
    model.value = want;
    chosen.set(selectKey(model), want);
  }
}

// The other direction, and the only one the AI select is ever written
// in (spec 179): what a phase runs on is one value on the job, and the
// tool is DERIVED from it.
//
// Called from two places, for the two ways a model select can end up on
// something the AI select beside it does not say. After a swap, because
// `restoreChosen` puts a hand-picked model back over the server's fresh
// markup and the AI select in that markup was drawn for the model the
// server chose. And on a live change, because a reader may go straight
// to the model select and ignore the picker beside it — leaving the
// line reading "Claude Code" over a Codex model until the next swap
// came round to fix it.
//
// The tool is read off the model option's own `data-tool`, which is the
// only place that fact lives in the browser.
function syncAiToModel(model: HTMLSelectElement): void {
  const form = model.getAttribute("form");
  const tool = model.selectedOptions[0]?.dataset.tool;
  if (!form || !tool) return;
  const ai = document.querySelectorAll(
    `select[data-ai="${model.name}"][form="${form}"]`,
  )[0] as HTMLSelectElement | undefined;
  if (!ai) return;
  for (const option of ai.options) {
    if (option.value === tool) ai.value = tool;
  }
}

// The one control in this file that deliberately NAVIGATES on success,
// against the rule at the top — because this form is a page (spec 121),
// not a panel on one. There is nothing here to put back into a clean
// state and no #jobrows beside it to refresh: the spec that was just
// made is a row on the LIST, and going there to see it is what pressing
// Create asked for. A refusal still answers in place, where what was
// typed is still typed.
async function submitCreate(form: HTMLFormElement, event: Event): Promise<void> {
  if (event.defaultPrevented) return;
  event.preventDefault();
  await postForm(
    form,
    async () => {
      location.href = "/";
    },
    (why) => formNote(form, why),
  );
}

// The Projects panel (spec 112): an Add form, and one Remove per
// allowlisted project. Bound directly rather than by delegation, and
// for the same reason the New-spec form is — the panel sits OUTSIDE
// #jobrows so a half-typed git URL survives the five-second swap.
//
// No refusal here has a row to land on: an Add names a project that was
// never added, a Remove that failed leaves the project exactly where the
// reader can already see it, and a Settings save that was refused wrote
// nothing. All go into the form's own `.refused` slot, like New spec's.
//
// The Settings page (spec 184) rides on this unchanged: it posts the
// same two fields and gets the same readiness answer back, so saving
// again re-assesses on the page the reader is already standing on.
async function submitProjectChange(form: HTMLFormElement, event: Event): Promise<void> {
  if (event.defaultPrevented) return;
  event.preventDefault();
  await postForm(
    form,
    async (body) => {
      // Spec 138: an Add that succeeded has something to SAY — whether
      // a run can start in the project just registered, and every
      // reason it cannot. Navigating would throw that away, which is
      // exactly what hid Skjer's missing specs root and dangling
      // default branch until someone pressed Run. So it stays here: on the page Save
      // was pressed, whose Specs root and Worktree links fields are
      // usually what fixes it, and where saving again re-assesses.
      const note = body?.readiness?.note;
      if (note) {
        // In the form's own message slot, which the server renders as a
        // refusal — so the look follows the answer: a project that CAN
        // run must not be reported in the colour of one that cannot.
        const slot = form.querySelector(".refused") as HTMLElement | null;
        if (slot) slot.className = `refused rowmsg ${body?.readiness?.canRun ? "info" : "warn"}`;
        formNote(form, note);
        return;
      }
      formNote(form, "");
      // A Remove has no such answer, and does what it always did: the
      // forms live on pages of their own (2026-08-19), so it returns to
      // the list it changed, with the reader's own query string (the
      // token rides there).
      location.href = "/projects" + location.search;
    },
    (why) => formNote(form, why),
  );
}

// The typed confirmation, client side: the button is off until the name
// is typed back exactly. The server refuses a mismatch either way —
// this is the half that means nobody has to be refused to find out.
//
// The button is rendered ENABLED and turned off here, never the other
// way round: a button the server rendered `disabled` could not be
// enabled again with script off, and every control on this page is a
// real form that works without it.
function bindTypedConfirm(form: HTMLFormElement): void {
  const wrap = form.querySelector("[data-confirm]") as HTMLElement | null;
  if (!wrap) return;
  const target = wrap.getAttribute("data-confirm") ?? "";
  const input = wrap.querySelector("input[name=confirm]") as HTMLInputElement | null;
  const button = wrap.querySelector("button") as HTMLButtonElement | null;
  if (!input || !button) return;
  const sync = (): void => void (button.disabled = input.value !== target);
  sync();
  input.addEventListener("input", sync);
}

/** Spec 184: the Add form's two settings, proposed for whichever
 *  checkout is picked. The server works one proposal out per offered
 *  checkout and puts them all on the form, because nothing is picked at
 *  the moment the page is drawn.
 *
 *  Only ever fills a field the reader has not typed in, and never
 *  overwrites what they did type: a proposal is help, and help that
 *  undoes an answer is not help. A checkout with nothing to propose
 *  clears the field back to blank, so the form never shows the previous
 *  pick's answer beside this one's name. */
function bindProposals(form: HTMLFormElement): void {
  const raw = form.dataset.proposals;
  if (!raw) return;
  let proposals: Record<string, { specsPath: string; worktreeLinks: string }>;
  try {
    proposals = JSON.parse(raw);
  } catch {
    return; // nothing to propose beats a page whose script died
  }
  const picker = form.querySelector('[name="existingPath"]') as HTMLSelectElement | null;
  if (!picker) return;
  const typed = new Set<string>();
  const fields = (["specsPath", "worktreeLinks"] as const).map((name) => {
    const input = form.querySelector(`[name="${name}"]`) as HTMLInputElement | null;
    input?.addEventListener("input", () => void typed.add(name));
    return { name, input };
  });
  picker.addEventListener("change", () => {
    const proposed = proposals[picker.value];
    for (const { name, input } of fields) {
      if (!input || typed.has(name)) continue;
      input.value = proposed?.[name] ?? "";
    }
  });
}

for (const el of document.querySelectorAll("form.addprojectform, form.removeform")) {
  const form = el as HTMLFormElement;
  bindTypedConfirm(form);
  bindProposals(form);
  form.addEventListener("submit", ((event: Event) => submitProjectChange(form, event)) as EventListener);
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
// And the row's selects and boxes, for the same reason: the rows are
// replaced wholesale on every tick, so a listener bound to a control
// itself would last five seconds.
document.getElementById("jobrows")?.addEventListener("change", ((event: Event) => {
  const target = event.target as Element | null;
  // A tail box's tick is a press, not something to remember for the
  // next redraw (spec 160): it goes to the server now, and what comes
  // back is what the row is drawn from. The promise is returned rather
  // than dropped — a listener's return value is nobody's to wait on,
  // and it is what lets the test wait for the request the tick makes.
  const tail = target?.closest?.("input[data-post-to]") as HTMLInputElement | null;
  if (tail) return postTailStep(tail);
  // A phase's AI picker fills that phase's model in and is done (spec
  // 179). It is intercepted BEFORE the branch below, and not only for
  // tidiness: it has no `name`, so `selectKey` would file every AI
  // select on the row under the same key — the form id and an empty
  // string — and the last one touched would decide the lot. Nothing
  // about it is remembered for the next redraw either; `applyAiPick`
  // records what it wrote under the select it wrote it into, and the
  // picker itself is set back from that select on the way out.
  const ai = target?.closest?.("select[data-ai]") as HTMLSelectElement | null;
  if (ai) return applyAiPick(ai);
  // Every other select on the rows IS remembered: they are swapped
  // away every five seconds, and a model picked for the next run is a
  // promise the page has to keep.
  const select = target?.closest?.("select") as HTMLSelectElement | null;
  if (select) {
    chosen.set(selectKey(select), select.value);
    // A model moved by hand, without the picker beside it: the AI that
    // line shows has to follow it now, not at the next swap.
    if (select.name?.startsWith("model.")) syncAiToModel(select);
  }
  // And the phase boxes, for the same reason and in a map of their own:
  // what is remembered about a box is whether it is ticked, which is
  // not a value a select can be restored from (spec 141).
  const step = target?.closest?.('input[name="steps"]') as HTMLInputElement | null;
  if (step) {
    chosenSteps.set(checkboxKey(step), step.checked);
    const rows = document.getElementById("jobrows");
    const formId = step.getAttribute("form");
    if (rows && formId) relabelRunButton(rows, formId);
  }
}) as EventListener);
// The one listener that is NOT delegated: this form is the whole of its
// own page, with no swapped container to hang a delegated one off.
// The handler's promise is returned rather than dropped — a listener's
// return value is ignored by the DOM, and it is what lets the test wait
// for the request the press makes.
const newSpec = document.querySelector(NEW_SPEC_FORM) as HTMLFormElement | null;
newSpec?.addEventListener("submit", ((event: Event) => submitCreate(newSpec, event)) as EventListener);
syncDependsOn();
newSpec?.querySelector("select[name=project]")?.addEventListener("change", syncDependsOn);
document.addEventListener("visibilitychange", tick);
// `?live=0` turns the refresh off for this page load, and nothing else
// about it changes. The page redraws on a timer, so the browser's own
// tools cannot be used on it: the ground moves every five seconds, and
// reading the markup or watching one element while changing something
// is impossible. Spec 189 is the real answer — the server says when
// something changed and the page redraws then. This is the switch that
// makes the page inspectable meanwhile, and it costs one condition.
if (new URLSearchParams(location.search).get("live") !== "0") {
  setInterval(tick, REFRESH_MS);
}
