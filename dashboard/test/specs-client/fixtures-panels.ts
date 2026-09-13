// The New-spec form and the Projects panel's Add/Remove forms,
// extracted out of harness() in fixtures.ts. Both take the shared
// `tokenInput` and the harness's own `on` event registry so their
// listeners land in the same place every other control's do.

import { chip, classes } from "./fixtures-controls.ts";

type Listener = (e: unknown) => void | Promise<void>;
type Chip = ReturnType<typeof chip>;

/** The New-spec form: it IS `/new` since spec 121 — no `#jobrows`
 *  beside it and no disclosure around it — so it is bound directly
 *  rather than by delegation, a second code path tested as one. */
export function buildCreateForm(chips: Chip[], tokenInput: { value: string }, on: Record<string, Listener>) {
  const createButton = {
    textContent: "Create",
    className: "btn primary",
    classList: {} as ReturnType<typeof classes>,
    innerHTML: "",
    title: "",
    disabled: false,
    isConnected: true,
    dataset: { pending: "creating…" },
    insertAdjacentHTML: (_where: string, html: string) => void (createButton.innerHTML += html),
  };
  createButton.classList = classes(createButton);
  const slot = { textContent: "" };
  const resets: number[] = [];
  // Spec 110's Depends-on chips: one wrapper per active spec, each
  // naming its own project, plus the Project select they are scoped to.
  // `reset()` reverts the select the way the browser's own does —
  // silently, without firing `change`, which is the whole reason the
  // reset path needs a re-sync of its own.
  const projectSelect = { value: "aide", addEventListener: (t: string, fn: Listener) => void (on[`select:${t}`] = fn) };
  const createForm = {
    action: "http://dash.test/api/queue/create",
    fields: [["project", "aide"], ["title", "A spec"]] as [string, string][],
    querySelectorAll: (sel: string) =>
      sel.includes("data-project") ? (chips as unknown as (typeof createButton)[]) : [createButton],
    querySelector: (sel: string) =>
      sel.includes("token")
        ? tokenInput
        : sel.includes("refused")
          ? slot
          : sel.includes("project")
            ? projectSelect
            : null,
    // Nothing wraps this form on `/new` — the page IS the form. A fake
    // that still handed a `<details>` back would let a re-added
    // panel-close pass unnoticed.
    closest: () => null,
    reset: () => {
      resets.push(1);
      projectSelect.value = "aide";
    },
    addEventListener: (type: string, fn: Listener) => void (on[`create:${type}`] = fn),
  };
  return { createButton, slot, resets, projectSelect, createForm };
}

/** Spec 112's Projects panel: one Remove form, with the typed
 *  confirmation the browser gates its button on, and (spec 138) one
 *  Add form, the one whose SUCCESS has something to say — the
 *  readiness answer the server worked out for the project that was
 *  just added. */
export function buildProjectsPanel(tokenInput: { value: string }, on: Record<string, Listener>) {
  // The button is rendered ENABLED by the server — turning it off is
  // this code's job, and a fake that started it disabled could not
  // tell the two apart.
  const removeButton = {
    textContent: "Remove",
    title: "",
    disabled: false,
    dataset: { pending: "removing…" },
    className: "btn danger",
    isConnected: true,
    insertAdjacentHTML: () => {},
    classList: {} as ReturnType<typeof classes>,
  };
  removeButton.classList = classes(removeButton);
  const confirmInput = { value: "" } as { value: string; addEventListener?: unknown };
  const confirmWrap = {
    getAttribute: (name: string) => (name === "data-confirm" ? "atlasaurus" : null),
    querySelector: (sel: string) => (sel.includes("input") ? confirmInput : removeButton),
  };
  const removeSlot = { textContent: "" };
  const addButton = {
    textContent: "Save",
    title: "",
    disabled: false,
    dataset: { pending: "saving…" },
    className: "btn primary",
    isConnected: true,
    insertAdjacentHTML: () => {},
    classList: {} as ReturnType<typeof classes>,
  };
  addButton.classList = classes(addButton);
  // `className` too: the slot the server renders is the REFUSAL slot,
  // and a success written into it must not stay the colour of one.
  const addSlot = { textContent: "", className: "refused rowmsg failed" };
  const addForm = {
    // Every real form element has one; spec 184's proposal binding reads
    // it, and an empty one is what a page with nothing to propose sends.
    dataset: {} as Record<string, string>,
    action: "http://dash.test/api/queue/projects",
    fields: [["name", "skjer"], ["existingPath", "skjer"]] as [string, string][],
    querySelectorAll: () => [addButton],
    querySelector: (sel: string) =>
      sel.includes("data-confirm")
        ? null
        : sel.includes("token")
          ? tokenInput
          : sel.includes("refused")
            ? addSlot
            : null,
    closest: () => null,
    addEventListener: (type: string, fn: Listener) => void (on[`add:${type}`] = fn),
  };
  const removeForm = {
    dataset: {} as Record<string, string>,
    action: "http://dash.test/api/queue/projects/atlasaurus/remove",
    fields: [["confirm", "atlasaurus"]] as [string, string][],
    querySelectorAll: () => [removeButton],
    querySelector: (sel: string) =>
      sel.includes("data-confirm")
        ? confirmWrap
        : sel.includes("token")
          ? tokenInput
          : sel.includes("refused")
            ? removeSlot
            : null,
    closest: () => null,
    addEventListener: (type: string, fn: Listener) => void (on[`remove:${type}`] = fn),
  };
  let typed: (() => void) | undefined;
  confirmInput.addEventListener = (type: string, fn: () => void) => {
    if (type === "input") typed = fn;
  };
  return {
    removeButton, confirmInput, confirmWrap, removeSlot,
    addButton, addSlot, addForm, removeForm,
    getTyped: () => typed,
  };
}
