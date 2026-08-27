// The two presses a phase LINE makes on a job that is already running
// — ticking a step, picking a model — plus the refusal banner every
// press on the page can land. Split out of queue-client.ts (split
// queue-client.ts into a bundled folder).

import { attrValue, refusalText, rowControls, type ActionResult, type Control } from "./press.ts";
import { swapRows } from "./row-swap.ts";
import { chosen, press, selectKey } from "./state.ts";

// A refusal used to navigate — and take the reader's view with it. It
// does not any more: the address bar is moved WITHOUT a document load,
// and the rows are re-asked with the same query the server's own
// redirect would have built. The filter and the sort live in that query,
// so they are read straight back out of it; dropping them would put
// every refusal back on the default list, which is the thing the plain
// form POST was fixed for. `errorSpec` is the server's own answer for
// WHICH row this belongs to, and `specHeadRow` puts it there.
export async function showRefusal(why: string, spec: string | undefined): Promise<void> {
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
export async function postTailStep(box: HTMLInputElement): Promise<void> {
  const to = box.getAttribute("data-post-to") ?? "";
  const formId = box.getAttribute("form") ?? "";
  const form = formId
    ? (document.querySelector(`form[id="${attrValue(formId)}"]`) as HTMLFormElement | null)
    : null;
  const controls = form ? rowControls(form) : [box as Control];
  const wanted = box.checked;
  const before = controls.map((el) => [el, el.disabled] as const);
  press.inFlight += 1;
  press.pressGen += 1;
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
    press.inFlight -= 1;
    for (const [el, was] of before) if (el.isConnected) el.disabled = was;
  }
}

/** The same press for the two SELECTS on a live phase line (spec 225).
 *
 *  Everything `postTailStep` does above and for the same reasons — the
 *  row locks while the request is out, the row is redrawn from the
 *  server's own answer, an unsendable request reloads the page — with
 *  one difference: what a select showed before the reader moved it is
 *  gone by the time this runs, so a refusal cannot put the old value
 *  back by hand. The swap `showRefusal` does brings the server's own
 *  value with it, and dropping the key from `chosen` is what stops the
 *  refused one being replayed over it.
 *
 *  The value is passed in rather than read off the select: `applyAiPick`
 *  calls this with the model it just wrote, and reading `.value` there
 *  would depend on the write having landed first.
 *
 *  The step is the select's own `name` — `model.<step>`, the field it
 *  posts under on a row that is not busy. */
export async function postTailModel(select: HTMLSelectElement, model: string): Promise<void> {
  const to = select.getAttribute("data-post-to") ?? "";
  const step = select.name.startsWith("model.") ? select.name.slice("model.".length) : "";
  if (!to || !step) return;
  const formId = select.getAttribute("form") ?? "";
  const form = formId
    ? (document.querySelector(`form[id="${attrValue(formId)}"]`) as HTMLFormElement | null)
    : null;
  const controls = form ? rowControls(form) : [select as Control];
  const before = controls.map((el) => [el, el.disabled] as const);
  press.inFlight += 1;
  press.pressGen += 1;
  for (const el of controls) el.disabled = true;
  try {
    const url = new URL(to, location.href);
    const token = form?.querySelector('input[name="token"]') as HTMLInputElement | null;
    if (token?.value) url.searchParams.set("token", token.value);
    const body = new URLSearchParams();
    body.append("step", step);
    body.append("model", model);
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const answer = (await res.json().catch(() => null)) as ActionResult | null;
    if (res.ok && answer?.ok) {
      // Remembered like any other hand-made pick: a phase still ahead
      // has no history for the server to draw the value back from, so
      // without this the swap that follows would put the configured
      // default over the model the job is now on.
      chosen.set(selectKey(select), model);
      await swapRows();
      return;
    }
    chosen.delete(selectKey(select));
    await showRefusal(refusalText(answer), answer?.spec);
  } catch {
    location.href = location.pathname + location.search;
  } finally {
    press.inFlight -= 1;
    for (const [el, was] of before) if (el.isConnected) el.disabled = was;
  }
}
