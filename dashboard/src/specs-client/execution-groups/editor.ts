// The New group dialog's form on the Jobs tab (`executionGroupEditor()` draws
// it): the list of specs is kept to the chosen project, the ticked ones are
// numbered in order, a project with fewer than two specs to group says so
// with Save off, and a dialog that closes starts over empty.

import { writeLine } from "../press.ts";

const EDITOR = "form[data-execution-group-editor]";
const RUN_GROUP = "form[data-run-group]";

function updateRunGroupName(form: HTMLFormElement): void {
  const field = form.querySelector<HTMLElement>("[data-run-group-name]");
  const name = field?.querySelector<HTMLInputElement>('input[name="groupName"]');
  if (!field || !name) return;
  const grouping = !!form.querySelector('input[name="member"]:checked');
  field.hidden = !grouping;
  name.disabled = !grouping;
}

function rows(form: HTMLFormElement): HTMLElement[] {
  return [...form.querySelectorAll<HTMLElement>("[data-group-project]")];
}

export function updateExecutionGroupEditor(form: HTMLFormElement): void {
  const project = form.querySelector<HTMLSelectElement>('select[name="project"]')?.value;
  for (const row of rows(form)) {
    row.hidden = !!project && row.dataset.groupProject !== project;
    const member = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const order = row.querySelector<HTMLInputElement>('input[name="position"]');
    if (!member || !order) continue;
    if (row.hasAttribute("data-group-locked")) continue;
    if (row.hidden) member.checked = false;
    order.disabled = !member.checked;
    if (!member.checked) order.value = "";
  }
  {
    const selected = rows(form).filter((row) => {
      const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
      return !row.hidden && !!box?.checked;
    }).sort((a, b) => {
      const value = (row: HTMLElement) => Number(row.querySelector<HTMLInputElement>('input[name="position"]')?.value) || Number.MAX_SAFE_INTEGER;
      return value(a) - value(b);
    });
    selected.forEach((row, index) => {
      const order = row.querySelector<HTMLInputElement>('input[name="position"]');
      if (order) order.value = String(index + 1);
    });
  }
  // A group needs two members, so a project with fewer has nothing to save.
  const enough = rows(form).filter((row) => !row.hidden).length >= 2;
  const none = form.querySelector<HTMLElement>("[data-group-none]");
  if (none) none.hidden = enough;
  const save = form.querySelector<HTMLButtonElement>('button[id$="-save"]');
  if (save) save.disabled = !enough;
}

export function changeExecutionGroupEditor(event: Event): boolean {
  const target = event.target as HTMLInputElement | HTMLSelectElement | null;
  const runForm = target?.closest?.(RUN_GROUP) as HTMLFormElement | null;
  if (runForm && target?.tagName === "INPUT" && target.getAttribute("name") === "member") {
    const changed = target as HTMLInputElement;
    const selected = [...runForm.querySelectorAll<HTMLInputElement>('input[name="member"]')]
      .filter((member) => member.checked)
      .sort((a, b) => Number(a.dataset.selectedAt ?? Number.MAX_SAFE_INTEGER) - Number(b.dataset.selectedAt ?? Number.MAX_SAFE_INTEGER));
    if (changed.checked && !changed.dataset.selectedAt) {
      const last = Math.max(0, ...[...runForm.querySelectorAll<HTMLInputElement>('input[name="member"]')]
        .map((member) => Number(member.dataset.selectedAt) || 0));
      changed.dataset.selectedAt = String(last + 1);
    }
    if (!changed.checked) delete changed.dataset.selectedAt;
    selected.sort((a, b) => Number(a.dataset.selectedAt ?? Number.MAX_SAFE_INTEGER) - Number(b.dataset.selectedAt ?? Number.MAX_SAFE_INTEGER));
    for (const member of runForm.querySelectorAll<HTMLInputElement>('input[name="member"]')) {
      const order = member.parentElement?.querySelector<HTMLInputElement>('input[name="position"]');
      if (!order) continue;
      const index = selected.indexOf(member);
      order.disabled = index < 0;
      order.value = index < 0 ? "" : String(index + 1);
    }
    updateRunGroupName(runForm);
    return true;
  }
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
  for (const form of root.querySelectorAll<HTMLFormElement>(RUN_GROUP)) updateRunGroupName(form);
}

/** A `close` event from the dialog that holds a New group form: the form is
 *  emptied, its reason with it, so the dialog opens again as new. Says
 *  whether the event was such a dialog's. */
export function closeExecutionGroupEditor(event: Event): boolean {
  const form = (event.target as Element | null)?.querySelector?.(`${EDITOR}, ${RUN_GROUP}`) as HTMLFormElement | null;
  if (!form) return false;
  form.reset();
  for (const member of form.querySelectorAll<HTMLInputElement>('input[name="member"]')) delete member.dataset.selectedAt;
  writeLine(form.querySelector(".refused"), "");
  if (form.matches(EDITOR)) updateExecutionGroupEditor(form);
  else {
    for (const order of form.querySelectorAll<HTMLInputElement>('input[name="position"]')) { order.value = ""; order.disabled = true; }
    updateRunGroupName(form);
  }
  return true;
}
