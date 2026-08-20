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
 *  The rows are replaced wholesale on every tick, and the server draws
 *  the AI picker with no `selected` at all — so the fresh one shows its
 *  first option, and the phase selects show the CONFIGURED model rather
 *  than the one just picked. Nothing about that is visible in the
 *  moment it happens. The cost is the press afterwards: a row asked for
 *  Codex, left alone for six seconds and then Run, started the step on
 *  Claude without a word.
 *
 *  Only hand-made choices are kept. A select nobody touched belongs to
 *  the server — that is how a phase that has run shows the model it
 *  really ran on — so this map stays empty until somebody changes
 *  something, and the swap behaves exactly as it did before. */
const chosen = new Map<string, string>();

const selectKey = (el: HTMLSelectElement): string => `${el.getAttribute("form") ?? ""}|${el.name}`;

/** The same promise for the phase boxes, reported the same day and
 *  twice: tick implement and archive, wait six seconds, press Run — and
 *  only what the server had ticked runs. The boxes all share the field
 *  name `steps` and are told apart by value, so the key carries it. */
const tickedByHand = new Map<string, boolean>();

const boxKey = (el: HTMLInputElement): string =>
  `${el.getAttribute("form") ?? ""}|${el.name}|${el.value}`;

/** Put the hand-made choices back on the rows that were just drawn.
 *
 *  The AI pickers go FIRST and re-narrow their row's model selects,
 *  because that filter moves a selection of its own (`syncToolFilter`):
 *  a model restored ahead of it would be re-picked by it and the
 *  restore would look like it had not happened. A remembered model is
 *  only put back if the fresh markup still offers it and the filter has
 *  not hidden it — a value no visible option carries is not a choice
 *  the row can honour. */
function restoreChosen(body: Element): void {
  restoreTicks(body);
  if (!chosen.size) return;
  for (const el of body.querySelectorAll("select[data-tool-picker]")) {
    const picker = el as HTMLSelectElement;
    const want = chosen.get(selectKey(picker));
    if (want === undefined) continue;
    picker.value = want;
    syncToolFilter(picker);
  }
  for (const el of body.querySelectorAll('select[name^="model."]')) {
    const model = el as HTMLSelectElement;
    const want = chosen.get(selectKey(model));
    if (want === undefined) continue;
    for (const option of model.options) {
      if (option.value === want && !option.hidden) model.value = want;
    }
  }
}

/** Put the hand-made ticks back, and the chip's look with them: a
 *  ticked input inside a chip the server drew as `default` is the same
 *  contradiction one layer down.
 *
 *  A DISABLED box is skipped — a busy row's boxes belong to the run,
 *  not to the reader. So is a chip in any state but `checked`/`default`:
 *  `busy`, `off` and `done` are the server's own precedence
 *  (`phaseChip` in render/components.ts), and repeating that rule here
 *  is how the two would drift apart. */
function restoreTicks(body: Element): void {
  if (!tickedByHand.size) return;
  for (const el of body.querySelectorAll('input[type="checkbox"][name="steps"]')) {
    const box = el as HTMLInputElement;
    if (box.disabled) continue;
    const want = tickedByHand.get(boxKey(box));
    if (want === undefined) continue;
    box.checked = want;
    const chip = box.closest("label.phase") as HTMLElement | null;
    if (!chip) continue;
    const look = chip.classList;
    if (!look.contains("checked") && !look.contains("default")) continue;
    look.toggle("checked", want);
    look.toggle("default", !want);
  }
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
const ACTIONS = "form.rowrun, form.actionform, form.mergeform, form.resolveform";

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
  results?: { error?: string; reason?: string; installError?: string; branchDeleteError?: string }[];
  /** An Add that SUCCEEDED and still has something to say: whether a
   *  run can start in the project it just registered (spec 138). The
   *  server writes the sentence — the same one its own redirect carries
   *  for a browser with no script — so there is one wording, not two. */
  readiness?: { canRun?: boolean; note?: string };
}

/** Why the server said no, whichever shape it said it in: merge answers
 *  per repo, the other four answer once. */
function refusalText(body: ActionResult | null): string {
  const perRepo = (body?.results ?? []).map((r) => r.error).filter(Boolean).join("; ");
  return perRepo || body?.error || "the request failed";
}

/** The one machine-readable refusal class the page acts on: a per-repo
 *  `reason: "conflict"` is what makes the row offer the resolve step.
 *  The no-JS redirect carries it as `errorReason`; this path lost it,
 *  and the resolve button never appeared for anyone with JS on. */
function refusalReason(body: ActionResult | null): string | undefined {
  return (body?.results ?? []).some((r) => r.reason === "conflict") ? "conflict" : undefined;
}

/** Post a form as JSON-wanting XHR and hand the answer on. The button
 *  work is the same for all five controls, and is the whole point: a
 *  press has to change something the instant it happens.
 *
 *  The form's own fields go with it. Merge needs none — but Run IS its
 *  fields (the phases ticked, the model, the other repos), and
 *  the hidden view fields are what the server rebuilds the reader's
 *  filter from on the no-JS path. */
async function postForm(
  form: HTMLFormElement,
  onOk: (body: ActionResult | null) => Promise<void> | void,
  onRefused: (why: string, spec: string | undefined, reason?: string) => Promise<void> | void,
): Promise<void> {
  const buttons = Array.from(form.querySelectorAll("button"));
  const primary = buttons[0];
  const label = primary?.textContent ?? "";
  const titleBefore = primary?.title ?? "";
  // A form on a spec's row, or the New-spec form above the table: the
  // two say they were pressed in different ways, and this is the only
  // question asked about where the form is.
  const row = form.closest("tr");
  const variant = VARIANTS.find((v) => primary?.classList.contains(v));
  for (const b of buttons) b.disabled = true;
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
    await onRefused(refusalText(answer), answer?.spec, refusalReason(answer));
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
async function showRefusal(why: string, spec: string | undefined, reason?: string): Promise<void> {
  const back = new URLSearchParams(location.search);
  // Handed over once as a cookie: putting it back in the address bar
  // would leave the token in history for nothing. `rows` and the two
  // this is about to set would otherwise be carried over from a URL
  // that is already showing a refusal.
  for (const drop of ["token", "rows", "error", "errorSpec", "errorReason"]) back.delete(drop);
  // Percent-encoded one key at a time, exactly as the server's own
  // redirect does it (`specsRedirect`): `URLSearchParams.toString()`
  // writes a space as `+`, and this string is a sentence a person reads
  // off the page it lands on.
  const parts = [...back].map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  parts.push(`error=${encodeURIComponent(why)}`);
  if (spec) parts.push(`errorSpec=${encodeURIComponent(spec)}`);
  if (reason) parts.push(`errorReason=${encodeURIComponent(reason)}`);
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

// The row's AI select (spec 127): one control instead of five. Picking
// a tool narrows every model select on that row to the models that
// tool actually runs, and moves any phase whose pick just went out of
// sight onto one still on offer — a select left pointing at a hidden
// option is a choice the reader can no longer see they are making,
// the same rule the Depends-on chips are held to above.
//
// Scoped by FORM ID, not by walking the row: the model selects are
// written outside their form's own tags and tied to it by that
// attribute alone, so the row is not a container that holds them.
//
// It runs on change and never on load. Every phase select is already
// pre-filled by the server with what that phase last ran on — a row
// whose phases ran on different tools is a real history, and filtering
// it on sight would re-pick for phases nobody touched.
function syncToolFilter(select: HTMLSelectElement): void {
  const form = select.getAttribute("form");
  if (!form) return;
  for (const el of document.querySelectorAll(`select[name^="model."][form="${form}"]`)) {
    const model = el as HTMLSelectElement;
    let firstVisible: HTMLOptionElement | undefined;
    for (const option of model.options) {
      option.hidden = option.dataset.tool !== select.value;
      if (!option.hidden && !firstVisible) firstVisible = option;
    }
    if (firstVisible && model.selectedOptions[0]?.hidden) model.value = firstVisible.value;
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
// Neither refusal has a row to land on: an Add names a project that was
// never added, and a Remove that failed leaves the project exactly
// where the reader can already see it. Both go into the form's own
// `.refused` slot, like New spec's.
async function submitProjectChange(form: HTMLFormElement, event: Event): Promise<void> {
  if (event.defaultPrevented) return;
  event.preventDefault();
  await postForm(
    form,
    async (body) => {
      // Spec 138: an Add that succeeded has something to SAY — whether
      // a run can start in the project just registered, and every
      // reason it cannot. Navigating would throw that away, which is
      // exactly what hid Skjer's dirty tree and missing specs root
      // until someone pressed Run. So it stays here: on the page Save
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

for (const el of document.querySelectorAll("form.addprojectform, form.removeform")) {
  const form = el as HTMLFormElement;
  bindTypedConfirm(form);
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
// And the row's AI select, for the same reason: the rows are replaced
// wholesale on every tick, so a listener bound to the select itself
// would last five seconds.
document.getElementById("jobrows")?.addEventListener("change", ((event: Event) => {
  const target = event.target as Element | null;
  const picker = target?.closest?.("select[data-tool-picker]") as HTMLSelectElement | null;
  // Every select on the rows is remembered, not only the picker: the
  // phase selects are swapped away just as often, and a model picked
  // for the next run is the same promise the AI picker makes.
  const select = picker ?? (target?.closest?.("select") as HTMLSelectElement | null);
  if (select) chosen.set(selectKey(select), select.value);
  if (picker) syncToolFilter(picker);
  // A phase box is the other half of the same promise.
  const box = target?.closest?.('input[type="checkbox"][name="steps"]') as HTMLInputElement | null;
  if (box) tickedByHand.set(boxKey(box), box.checked);
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
setInterval(tick, REFRESH_MS);
