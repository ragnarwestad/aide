// The Depends on picker on a Running tab row (`render/pages/specs-list/depends-on/`),
// and the spec's settings under it. A tick or a level is remembered like a
// ticked phase box or a picked model, so a live redraw keeps it; Cancel is
// offered while anything differs from what the server drew, and puts it back.

import { checkboxKey, chosen, chosenSteps, clearChosenSteps, selectKey } from "../state.ts";

// Selectors write the attribute value unquoted, which CSS allows for an
// identifier: quoted, the page script would carry the literal
// `name="dependsOn"`, and a page test looking for that field would find
// the script instead.
const boxesOf = (form: Element): HTMLInputElement[] =>
  Array.from(form.querySelectorAll("input[type=checkbox][name=dependsOn]")) as HTMLInputElement[];

/** The settings' own boxes and the checks level: what posts besides the ticks. */
const settingBoxesOf = (form: Element): HTMLInputElement[] =>
  Array.from(form.querySelectorAll("input[type=checkbox][name]:not([name=dependsOn])")) as HTMLInputElement[];
const selectsOf = (form: Element): HTMLSelectElement[] => Array.from(form.querySelectorAll("select[name]")) as HTMLSelectElement[];

const cancelOf = (form: Element): HTMLButtonElement | undefined =>
  (Array.from(form.querySelectorAll("button")) as HTMLButtonElement[]).find((b) => b.id === `${form.id}-cancel`);

/** A tick on a chip is the chip mover's cue (`ui/forms/depends-lift.ts`),
 *  which listens for `change`; a restore is silent, so the cue is sent. */
const announce = (box: HTMLInputElement): void => {
  box.dispatchEvent(new Event("change", { bubbles: true }));
};

/** The level the server drew: the option it marked `selected`. */
const drawnLevel = (select: HTMLSelectElement): string =>
  (Array.from(select.options).find((o) => o.hasAttribute("selected")) ?? select.options[0])?.value ?? "";

/** Cancel is offered while any box or level differs from the one drawn. */
export function syncDependsOnCancel(form: Element): void {
  const cancel = cancelOf(form);
  if (!cancel) return;
  const boxMoved = [...boxesOf(form), ...settingBoxesOf(form)].some((b) => b.checked !== b.defaultChecked);
  const levelMoved = selectsOf(form).some((s) => s.value !== drawnLevel(s));
  cancel.disabled = !boxMoved && !levelMoved;
}

/** A setting changed by hand: a box remembered as a tick is, a level as a picked model is. */
export function pickSetting(control: HTMLInputElement | HTMLSelectElement): void {
  const form = control.closest("form.dependsform");
  if (!form) return;
  if (control.tagName === "SELECT") chosen.set(selectKey(control as HTMLSelectElement), control.value);
  else chosenSteps.set(checkboxKey(control as HTMLInputElement), (control as HTMLInputElement).checked);
  syncDependsOnCancel(form);
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
  for (const select of selectsOf(form)) select.value = drawnLevel(select);
  for (const box of boxesOf(form)) announce(box);
  // After the events: they pass through `pickDependency`, which remembers.
  clearChosenSteps(form.id);
  for (const key of [...chosen.keys()]) if (key.startsWith(`${form.id}|`)) chosen.delete(key);
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
