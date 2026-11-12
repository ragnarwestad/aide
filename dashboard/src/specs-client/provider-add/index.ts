// The Add dialog's three steps on the Providers tab (`provider-add.ts`
// draws it): Next checks the step's own fields before it moves on, the ID
// is made from the name until it is typed in itself, step 3 turns on the
// chosen tool's fields alone, and the login command is written out as they
// are typed. Closing the dialog starts it over at step 1, empty.

import { providerKeyFrom } from "../../queue/providers/key.ts";
import { providerLoginCommand } from "../../queue/providers/login-command.ts";
import type { ProviderTool } from "../../queue/providers/index.ts";

const LAST = 3;

export function bindProviderAdd(dialog: HTMLDialogElement): void {
  // The posting form, the dialog's first; its affirmative is `<form id>-save`
  // (`formDialog()`), and Cancel is the dialog's own close.
  const form = dialog.querySelector("form") as HTMLFormElement | null;
  if (!form) return;
  const save = form.querySelector(`[id="${form.id}-save"]`) as HTMLButtonElement | null;
  const name = form.querySelector('input[name="name"]') as HTMLInputElement | null;
  const id = form.querySelector('input[name="providerId"]') as HTMLInputElement | null;
  const command = form.querySelector("[data-login-command]") as HTMLElement | null;
  const refused = form.querySelector(".refused") as HTMLElement | null;
  const button = (hook: string) => form.querySelector(`[data-${hook}]`) as HTMLButtonElement | null;
  let step = 1;
  let idTyped = false;

  const tool = (): ProviderTool | undefined =>
    ((form.querySelector('input[name="tool"]:checked') as HTMLInputElement | null)?.value as ProviderTool | undefined);
  const toolPart = (which: string) => form.querySelector(`.addtool[data-tool="${which}"]`) as HTMLElement | null;

  function writeCommand(): void {
    const chosen = tool();
    const part = chosen ? toolPart(chosen) : null;
    if (!command || !chosen || !part) return;
    const value = (field: string) =>
      (part.querySelector(`input[name="${field}"]`) as HTMLInputElement | null)?.value.trim() || undefined;
    command.textContent = providerLoginCommand({
      tool: chosen, binary: value("binary"), configDir: value("configDir"), codexHome: value("codexHome"), shadowHome: value("shadowHome"),
    });
  }

  function show(next: number): void {
    step = next;
    for (const el of form!.querySelectorAll(".addstep")) (el as HTMLElement).hidden = (el as HTMLElement).dataset.step !== String(step);
    for (const el of form!.querySelectorAll(".addsteps li")) {
      if ((el as HTMLElement).dataset.step === String(step)) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    }
    const back = button("add-back");
    const ahead = button("add-next");
    if (back) back.hidden = step === 1;
    if (ahead) ahead.hidden = step === LAST;
    if (save) save.hidden = step !== LAST;
    if (step === LAST) {
      const chosen = tool();
      for (const el of form!.querySelectorAll(".addtool")) {
        const own = (el as HTMLElement).dataset.tool === chosen;
        (el as HTMLElement).hidden = !own;
        const fields = el.querySelector("fieldset") as HTMLFieldSetElement | null;
        if (fields) fields.disabled = !own;
      }
      writeCommand();
    }
  }

  /** The current step's own fields, each asked in turn; the first that is
   *  not filled in right says so and keeps the step where it is. */
  function stepIsFilled(): boolean {
    const here = form!.querySelector(`.addstep[data-step="${step}"]`);
    for (const el of here?.querySelectorAll("input") ?? []) {
      if (!(el as HTMLInputElement).reportValidity()) return false;
    }
    return true;
  }

  function forward(): void {
    if (step < LAST && stepIsFilled()) show(step + 1);
  }

  button("add-next")?.addEventListener("click", forward);
  button("add-back")?.addEventListener("click", () => show(Math.max(1, step - 1)));
  // Enter in a field before the last step moves on rather than adding. Taken
  // in the capture phase, ahead of the listener that posts the form.
  form.addEventListener(
    "submit",
    (event) => {
      if (step === LAST) return;
      event.preventDefault();
      forward();
    },
    { capture: true },
  );
  name?.addEventListener("input", () => {
    if (id && !idTyped) id.value = name.value.trim() ? providerKeyFrom(name.value) : "";
  });
  id?.addEventListener("input", () => {
    idTyped = id.value !== "";
  });
  form.addEventListener("input", (event) => {
    if ((event.target as Element | null)?.closest?.(".addtool")) writeCommand();
  });
  form.addEventListener("change", (event) => {
    if ((event.target as HTMLInputElement | null)?.name === "tool") forward();
  });
  dialog.addEventListener("close", () => {
    form.reset();
    idTyped = false;
    if (refused) refused.textContent = "";
    if (command) command.textContent = "";
    show(1);
  });
  show(1);
}
