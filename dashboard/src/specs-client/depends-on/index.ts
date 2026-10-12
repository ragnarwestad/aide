// The Depends on picker on a Running tab row (`render/pages/specs-list/depends-on/`).
// A tick is remembered like a ticked phase box, so a live redraw keeps it;
// Cancel is offered while a box differs from what the server drew, and
// puts the drawn ticks back.

import { checkboxKey, chosenSteps, clearChosenSteps } from "../state.ts";

// Selectors write the attribute value unquoted, which CSS allows for an
// identifier: quoted, the page script would carry the literal
// `name="dependsOn"`, and a page test looking for that field would find
// the script instead.
const boxesOf = (form: Element): HTMLInputElement[] =>
  Array.from(form.querySelectorAll("input[type=checkbox][name=dependsOn]")) as HTMLInputElement[];

const cancelOf = (form: Element): HTMLButtonElement | undefined =>
  (Array.from(form.querySelectorAll("button")) as HTMLButtonElement[]).find((b) => b.id === `${form.id}-cancel`);

/** A tick on a chip is the chip mover's cue (`ui/forms/depends-lift.ts`),
 *  which listens for `change`; a restore is silent, so the cue is sent. */
const announce = (box: HTMLInputElement): void => {
  box.dispatchEvent(new Event("change", { bubbles: true }));
};

/** Cancel is offered while any box differs from the one drawn. */
export function syncDependsOnCancel(form: Element): void {
  const cancel = cancelOf(form);
  if (cancel) cancel.disabled = !boxesOf(form).some((b) => b.checked !== b.defaultChecked);
}

/** A box ticked or cleared by hand. */
export function pickDependency(box: HTMLInputElement): void {
  const form = box.closest("form.dependsform");
  if (!form) return;
  chosenSteps.set(checkboxKey(box), box.checked);
  syncDependsOnCancel(form);
}

/** Cancel: the form as the server drew it, the chips back in their blocks
 *  and the ticks forgotten, so the next redraw does not bring them back. */
export function cancelDependsOn(button: HTMLButtonElement): void {
  const form = button.closest("form.dependsform") as HTMLFormElement | null;
  if (!form) return;
  form.reset();
  for (const box of boxesOf(form)) announce(box);
  // After the events: they pass through `pickDependency`, which remembers.
  clearChosenSteps(form.id);
  syncDependsOnCancel(form);
}

/** After a redraw put remembered ticks back silently: each chip moves to
 *  the block its box is in, and Cancel follows. */
export function syncDependsOnForms(body: Element): void {
  for (const form of body.querySelectorAll("form.dependsform")) {
    for (const box of boxesOf(form)) if (box.checked !== box.defaultChecked) announce(box);
    syncDependsOnCancel(form);
  }
}

/** The Cancel press, delegated from the rows' container. */
export function onDependsOnCancel(event: Event): void {
  const button = (event.target as Element | null)?.closest?.('form.dependsform button[type="button"]') as HTMLButtonElement | null;
  if (typeof button?.id === "string" && button.id.endsWith("-cancel")) cancelDependsOn(button);
}
