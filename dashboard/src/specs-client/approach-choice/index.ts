// The approach radios under a row's waiting line
// (`render/pages/specs-list/approach-choice/`). A pick is remembered like
// a ticked box, so a live redraw keeps it; Cancel is offered while the
// pick is not the recommended one the server drew, and puts that one back.

import { checkboxKey, chosenSteps, clearChosenSteps } from "../state.ts";

const radiosOf = (form: Element): HTMLInputElement[] =>
  Array.from(form.querySelectorAll('input[type="radio"][name="approach"]')) as HTMLInputElement[];

const cancelOf = (form: Element): HTMLButtonElement | undefined =>
  (Array.from(form.querySelectorAll("button")) as HTMLButtonElement[]).find((b) => b.id === `${form.id}-cancel`);

/** Cancel is offered while the pick differs from the one drawn checked. */
export function syncApproachCancel(form: Element): void {
  const cancel = cancelOf(form);
  if (cancel) cancel.disabled = !radiosOf(form).some((r) => r.checked !== r.defaultChecked);
}

/** A radio picked by hand. Every radio of the group is remembered as it
 *  now stands: the one that lost its pick fires no event of its own. */
export function pickApproach(radio: HTMLInputElement): void {
  const form = radio.closest("form.approachform");
  if (!form) return;
  for (const r of radiosOf(form)) chosenSteps.set(checkboxKey(r), r.checked);
  syncApproachCancel(form);
}

/** Cancel: the form as the server drew it, and the pick forgotten, so the
 *  next redraw does not bring it back. */
export function cancelApproach(button: HTMLButtonElement): void {
  const form = button.closest("form.approachform") as HTMLFormElement | null;
  if (!form) return;
  form.reset();
  clearChosenSteps(form.id);
  syncApproachCancel(form);
}

/** Every approach form's Cancel, after a redraw put a remembered pick back. */
export function syncApproachCancels(body: Element): void {
  for (const form of body.querySelectorAll("form.approachform")) syncApproachCancel(form);
}

/** The Cancel press, delegated from the rows' container. */
export function onApproachCancel(event: Event): void {
  const button = (event.target as Element | null)?.closest?.("form.approachform button[type=\"button\"]") as HTMLButtonElement | null;
  if (typeof button?.id === "string" && button.id.endsWith("-cancel")) cancelApproach(button);
}
