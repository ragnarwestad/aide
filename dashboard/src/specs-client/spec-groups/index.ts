import { checkboxKey, chosenSteps } from "../state.ts";

/** The reader's own choice per card, with the chosen state the card carried
 *  (`data-group-open`, empty under All) when it was made. */
const expanded = new Map<string, { open: boolean; under: string }>();

/** Each group card on the page shown open or shut: the reader's own choice
 *  while the page lives and the chosen state stays the one it was made
 *  under, otherwise open when a chosen state shows the card or a member's
 *  spec is open in it. Shut hides the group's second line and its members. */
export function syncSpecGroups(root: ParentNode): void {
  for (const group of root.querySelectorAll<HTMLElement>("tr[data-spec-group]")) {
    const key = group.getAttribute("data-spec-group")!;
    const under = group.getAttribute("data-group-open") ?? "";
    if (expanded.has(key) && expanded.get(key)!.under !== under) expanded.delete(key);
    const open = expanded.get(key)?.open ?? (under !== "" || group.querySelector("[data-spec-detail]") !== null);
    const button = group.querySelector("[data-group-toggle]");
    button?.setAttribute("aria-expanded", String(open));
    button?.classList.toggle("shut", !open);
    for (const part of group.querySelectorAll<HTMLElement>("[data-group-body]")) part.hidden = !open;
    const action = group.querySelector<HTMLElement>("[data-group-action]");
    const actionForm = action?.querySelector<HTMLFormElement>("form");
    if (actionForm) syncGroupPhaseAction(actionForm);
    if (action) action.hidden = !open;
  }
}

export function toggleSpecGroup(event: MouseEvent): void {
  const button = (event.target as Element | null)?.closest?.("[data-group-toggle]");
  if (!button) return;
  event.preventDefault();
  const under = button.closest("tr[data-spec-group]")?.getAttribute("data-group-open") ?? "";
  expanded.set(button.getAttribute("data-group-toggle")!, { open: button.getAttribute("aria-expanded") !== "true", under });
  syncSpecGroups(button.ownerDocument);
}

/** Keep the whole member choice when any box changes, including an empty choice. */
export function rememberGroupPhases(box: HTMLInputElement): void {
  const card = box.closest("tr[data-spec-group]");
  if (!card) return;
  for (const input of card.querySelectorAll<HTMLInputElement>('input[name="steps"]')) {
    if (input.getAttribute("form") === box.getAttribute("form")) chosenSteps.set(checkboxKey(input), input.checked);
  }
  const form = card.querySelector<HTMLFormElement>("[data-group-action] form");
  if (form) syncGroupPhaseAction(form);
}

export function groupPhaseForms(form: HTMLFormElement): { folder: string; id: string }[] {
  const card = form.closest("tr[data-spec-group]");
  const project = card?.getAttribute("data-spec-group")?.split("\n")[0];
  return !card || !project ? [] : Array.from(card.querySelectorAll<HTMLElement>("tr[data-folder]")).map((row) => ({
    folder: row.dataset.folder!, id: `rowrun-${project}/${row.dataset.folder}`,
  }));
}

/** Only a person's changed choices can request a rerun of completed work. */
export function groupPhaseChoices(form: HTMLFormElement): Record<string, string[]> {
  return Object.fromEntries(groupPhaseForms(form).flatMap(({ folder, id }) => {
    const choices = [...chosenSteps].filter(([key]) => key.startsWith(`${id}|steps|`));
    return choices.length ? [[folder, choices.filter(([key, checked]) => checked &&
      ["analyze", "implement"].includes(key.split("|")[2]!)).map(([key]) => key.split("|")[2]!)]] : [];
  }));
}

function syncGroupPhaseAction(form: HTMLFormElement): void {
  const original = form.dataset.groupDefaultAction;
  if (original !== "start" && original !== "archive") return;
  const rerun = Object.values(groupPhaseChoices(form)).some((steps) => steps.length > 0);
  const action = rerun ? "start" : original;
  const field = form.querySelector<HTMLInputElement>('input[name="action"]');
  const button = form.querySelector("button");
  if (field) field.value = action;
  if (button) button.textContent = action === "start" ? form.dataset.groupLabelStart! : form.dataset.groupLabelArchive!;
}
