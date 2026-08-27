// Post a form as JSON-wanting XHR and lock the row while it is out —
// the one press mechanism every button and select on this page shares.

import { press } from "./state.ts";

/** Every form in `#jobrows` this file speaks for. They differ in what
 *  they ask the server, not in what pressing them should look like. */
export const ACTIONS = "form.rowrun, form.actionform";

/** Character for character what `components.ts` renders (`SPINNER`).
 *  One runs server-side and the other is bundled for the browser, so
 *  the two are hand-paired rather than sharing an import — a test reads
 *  both (`test/queue-client/busy-state-and-locking.test.ts`). Change one
 *  and change the other. */
export const SPINNER = `<span class="spin" aria-hidden="true"></span>`;

/** The looks a button can arrive in. `busy` goes IN PLACE of whichever
 *  one it has, the same swap `btn()` makes server-side for a job
 *  already in flight — two variants at once is a button with two
 *  looks. */
export const VARIANTS = ["primary", "ok", "danger"];

export interface ActionResult {
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
export function refusalText(body: ActionResult | null): string {
  const perStep = (body?.results ?? []).map((r) => r.error).filter(Boolean).join("; ");
  return perStep || body?.error || "the request failed";
}

/** A value quoted inside an attribute selector. The ids it is used on
 *  are `rowrun-<project>/<specFolder>`, which needs no escaping at all
 *  — but a quote in a folder name would end the selector early, and
 *  that is a page that throws rather than a lookup that misses. */
export const attrValue = (v: string): string => v.replace(/["\\]/g, "\\$&");

/** Everything written OUTSIDE a form and tied to it by name alone. On
 *  a spec's row that is the Run button, the four phase boxes, the five
 *  model selects and the five AI selects: the trick spec 123 introduced so
 *  the button could sit above the phase lines and the boxes on them,
 *  while the form itself carries nothing but hidden fields. */
export const namesForm = (id: string): Element[] =>
  id ? Array.from(document.querySelectorAll(`[form="${attrValue(id)}"]`)) : [];

export type Control = HTMLButtonElement | HTMLInputElement | HTMLSelectElement;

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
export function rowControls(form: HTMLFormElement): Control[] {
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
export async function postForm(
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
  press.inFlight += 1;
  press.pressGen += 1;
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
    press.inFlight -= 1;
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
