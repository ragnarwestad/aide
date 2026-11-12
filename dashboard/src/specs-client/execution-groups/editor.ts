function rows(form: HTMLFormElement): HTMLElement[] {
  return [...form.querySelectorAll<HTMLElement>("[data-group-project]")];
}

interface ExecutionGroupDraft {
  action: string;
  open: boolean;
  project?: string;
  name?: string;
  members: Map<string, { checked: boolean; position: string }>;
}

export function captureExecutionGroupEditors(root: Element): ExecutionGroupDraft[] {
  return [...root.querySelectorAll<HTMLFormElement>("form[data-execution-group-editor]")].map((form) => ({
    action: form.getAttribute("action") ?? "",
    open: !!form.closest("details")?.hasAttribute("open"),
    project: form.querySelector<HTMLSelectElement>('select[name="project"]')?.value,
    name: form.querySelector<HTMLInputElement>('input[name="name"]')?.value,
    members: new Map(rows(form).flatMap((row) => {
      const member = row.querySelector<HTMLInputElement>('input[name="member"]');
      const position = row.querySelector<HTMLInputElement>('input[name="position"]');
      return member && position ? [[member.value, { checked: member.checked, position: position.value }]] : [];
    })),
  }));
}

export function restoreExecutionGroupEditors(root: Element, drafts: ExecutionGroupDraft[]): void {
  for (const form of root.querySelectorAll<HTMLFormElement>("form[data-execution-group-editor]")) {
    const draft = drafts.find((candidate) => candidate.action === (form.getAttribute("action") ?? ""));
    const project = form.querySelector<HTMLSelectElement>('select[name="project"]');
    const name = form.querySelector<HTMLInputElement>('input[name="name"]');
    if (draft?.project !== undefined && project) project.value = draft.project;
    if (draft?.name !== undefined && name) name.value = draft.name;
    updateExecutionGroupEditor(form);
    if (!draft) continue;
    const details = form.closest("details") as HTMLDetailsElement | null;
    if (details) details.open = draft.open;
    for (const row of rows(form)) {
      const member = row.querySelector<HTMLInputElement>('input[name="member"]');
      const position = row.querySelector<HTMLInputElement>('input[name="position"]');
      const saved = member ? draft.members.get(member.value) : undefined;
      if (!member || !position || !saved || row.hidden) continue;
      member.checked = saved.checked;
      position.disabled = !saved.checked;
      position.value = saved.checked ? saved.position : "";
    }
  }
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
