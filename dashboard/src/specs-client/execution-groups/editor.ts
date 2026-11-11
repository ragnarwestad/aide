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
  const form = target?.closest?.("form[data-execution-group-editor]") as HTMLFormElement | null;
  if (!form?.matches?.("form[data-execution-group-editor]")) return false;
  if (!["member", "project"].includes(target?.getAttribute("name") ?? "")) return true;
  updateExecutionGroupEditor(form);
  return true;
}

export function openExecutionGroupEditor(event: Event): boolean {
  const button = (event.target as Element | null)?.closest?.("[data-edit-execution-group]") as HTMLElement | null;
  const id = button?.dataset.editExecutionGroup;
  if (!id) return false;
  const form = button.ownerDocument.querySelector<HTMLFormElement>(`form[action="/api/queue/groups/${CSS.escape(id)}"]`);
  const details = form?.closest("details") as HTMLDetailsElement | null;
  if (!details) return false;
  details.open = true;
  form?.scrollIntoView?.({ block: "nearest" });
  event.preventDefault();
  return true;
}
