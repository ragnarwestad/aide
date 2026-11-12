// The New group dialog's form on the Jobs tab (`executionGroupEditor()` draws
// it): the list of specs is kept to the chosen project, the ticked ones are
// numbered in order, and a dialog that closes starts over empty.

import { writeLine } from "../press.ts";

const EDITOR = "form[data-execution-group-editor]";

function rows(form: HTMLFormElement): HTMLElement[] {
  return [...form.querySelectorAll<HTMLElement>("[data-group-project]")];
}

export function updateExecutionGroupEditor(form: HTMLFormElement): void {
  const project = form.querySelector<HTMLSelectElement>('select[name="project"]')?.value;
  let position = 0;
  for (const row of rows(form)) {
    row.hidden = !!project && row.dataset.groupProject !== project;
    const member = row.querySelector<HTMLInputElement>('input[name="member"]');
    const order = row.querySelector<HTMLInputElement>('input[name="position"]');
    if (!member || !order) continue;
    if (row.hidden) member.checked = false;
    order.disabled = !member.checked;
    if (member.checked) order.value = String(++position);
    else order.value = "";
  }
}

export function changeExecutionGroupEditor(event: Event): boolean {
  const target = event.target as HTMLInputElement | HTMLSelectElement | null;
  const form = target?.closest?.(EDITOR) as HTMLFormElement | null;
  if (!form?.matches?.(EDITOR)) return false;
  if (!["member", "project"].includes(target?.getAttribute("name") ?? "")) return true;
  updateExecutionGroupEditor(form);
  return true;
}

/** Every New group form under `root` brought in line with its own fields:
 *  when the page is mounted, and after the rows it is drawn with are replaced. */
export function syncExecutionGroupEditors(root: ParentNode): void {
  for (const form of root.querySelectorAll<HTMLFormElement>(EDITOR)) updateExecutionGroupEditor(form);
}

/** A `close` event from the dialog that holds a New group form: the form is
 *  emptied, its reason with it, so the dialog opens again as new. Says
 *  whether the event was such a dialog's. */
export function closeExecutionGroupEditor(event: Event): boolean {
  const form = (event.target as Element | null)?.querySelector?.(EDITOR) as HTMLFormElement | null;
  if (!form) return false;
  form.reset();
  writeLine(form.querySelector(".refused"), "");
  updateExecutionGroupEditor(form);
  return true;
}
