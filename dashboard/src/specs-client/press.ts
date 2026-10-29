// Post a form as JSON-wanting XHR and lock the row while it is out —
// the one press mechanism every button and select on this page shares.

import { clearRefusal } from "./row-refusal";
import { specRowsOf } from "./row-swap.ts";
import { press } from "./state.ts";

/** Every form in `#jobrows` this file speaks for. They differ in what
 *  they ask the server, not in what pressing them should look like. */
export const ACTIONS = "form.rowrun, form.actionform";

/** Character for character what `components.ts` renders (`SPINNER`).
 *  One runs server-side and the other is bundled for the browser, so
 *  the two are hand-paired rather than sharing an import. Change one
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
   *  a refusal can name WHICH step refused. */
  results?: { error?: string }[];
  /** An Add that SUCCEEDED and still has something to say: whether a
   *  run can start in the project it just registered. */
  readiness?: { canRun?: boolean; note?: string };
  /** The project a project route answered for (`answerProjectChange`). */
  project?: string;
  /** The job a queue request started, for a caller that waits for it. */
  job?: { id?: string; project?: string; specFolder?: string; steps?: string[]; stepIndex?: number };
  /** Where a saved schedule entry goes next: the page it was opened from. */
  location?: string;
  /** What a press that went through says about itself ("saved
   *  1-description.md", "already up to date"). */
  note?: string;
  /** False for a press that went through and changed nothing, so the
   *  page has nothing new to load. */
  changed?: boolean;
}

/** Why the server said no, whichever shape it said it in: the project
 *  routes answer per step, the queue routes answer once. */
export function refusalText(body: ActionResult | null): string {
  const perStep = (body?.results ?? []).map((r) => r.error).filter(Boolean).join("; ");
  return perStep || body?.error || "the request failed";
}

/** Writes `text` into a message line `messageSlot()` drew: into its
 *  words, so the icon the server drew stays, first letter capitalised as
 *  the server writes it. An empty text empties the line, which then
 *  draws nothing. */
export function writeLine(line: Element | null | undefined, text: string): void {
  if (!line) return;
  const words = line.querySelector?.("span") ?? line;
  words.textContent = text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

/** A value quoted inside an attribute selector. The ids it is used on
 *  are `rowrun-<project>/<specFolder>`, which needs no escaping at all
 *  — but a quote in a folder name would end the selector early, and
 *  that is a page that throws rather than a lookup that misses. */
export const attrValue = (v: string): string => v.replace(/["\\]/g, "\\$&");

/** Everything written OUTSIDE a form and tied to it by name alone. On
 *  a spec's row that is the Run button, the four phase boxes, the five
 *  model selects and the five AI selects: the trick that lets
 *  the button sit above the phase lines and the boxes on them,
 *  while the form itself carries nothing but hidden fields. */
export const namesForm = (id: string): Element[] =>
  id ? Array.from(document.querySelectorAll(`[form="${attrValue(id)}"]`)) : [];

export type Control = HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** What a person can press, tick, pick or type in. Hidden fields are no one's to press. */
const PRESSABLE = "button, select, textarea, input:not([type=hidden])";

/** Every control a press has to lock: on a spec's rows, every one of them —
 *  the head row and everything up to the next spec, the open spec
 *  included, and nothing of another spec; elsewhere, the form's own. Either
 *  way, with what is written outside the form and names it with `form=`.
 *
 *  A descendants-only lookup would miss the Run button, which is written
 *  after its form's closing tag and reaches it by `form="…"`, and would
 *  leave every other control of the spec live for the whole round-trip,
 *  so a second press could land on the spec while the first is half-way. */
export function rowControls(form: HTMLFormElement): Control[] {
  const scope = specRowsOf(form) ?? [form];
  const inScope = scope.flatMap((el) => Array.from(el.querySelectorAll(PRESSABLE)));
  return [...new Set([...inScope, ...namesForm(form.id)])] as Control[];
}

/** Post a form as JSON-wanting XHR and hand the answer on. The button
 *  work is the same for every control, and is the whole point: a press
 *  has to change something the instant it happens.
 *
 *  The form's own fields go with it. Cancel needs none — but Run IS its
 *  fields (the phases ticked, the model, the other repos). */
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
  // A new press: whatever the last one on the list was refused for is over.
  clearRefusal();
  press.inFlight += 1;
  press.pressGen += 1;
  // SOMETHING has to change the moment it is pressed. The work behind
  // these buttons takes seconds, and a button that looks untouched for
  // that long reads as a button that did not register the click.
  //
  // What changes is the LOOK, not the word: a button that swapped "Run"
  // for "starting…" grew to fit and took the whole row with it, at the
  // one moment it should look most in control. So it goes
  // busy — the same variant the server renders for a job already in
  // flight — and the server's own pending word (`data-pending`) moves
  // to the `title`, where it costs no width. The spinner goes inside
  // the button, where it costs no width either.
  //
  // It used to be put where the row's phase boxes were instead, and
  // borrow their width. Those boxes are on the phase LINES now —
  // a different `<tr>` from the button — and the only `.phases`
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
      primary.textContent = primary.dataset?.pending || "Working…";
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
    const url = new URL(form.action, location.href);
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
    // PATH: this code runs on `/projects` too.
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

/** Moves a `switchControl()` button: its position, the word beside it and
 *  whether it can be pressed, from one call so the three cannot disagree. */
export function setSwitch(el: HTMLElement, s: { checked: boolean; disabled: boolean }): void {
  el.setAttribute("aria-checked", String(s.checked));
  (el as HTMLButtonElement).disabled = s.disabled;
  const word = el.querySelector(".switchword");
  if (word) word.textContent = (s.checked ? el.dataset.on : el.dataset.off) ?? "";
}
