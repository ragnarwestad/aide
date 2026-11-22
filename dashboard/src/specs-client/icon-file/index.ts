// The Config tab's Choose file dialog (`icon-dialogs.ts` draws it): the page
// posts forms URL-encoded, which would turn a picked file into its name, so
// the file is read here into the form's `filename` and `data` fields as
// base64. Save stays shut from the moment a file is picked until the newest
// pick has been read; an older read that ends later is thrown away. The
// server checks the type and the size.

import { writeLine } from "../press.ts";

export function bindIconFile(dialog: HTMLDialogElement): () => void {
  const form = dialog.querySelector("form") as HTMLFormElement | null;
  const input = dialog.querySelector("input[data-icon-file]") as HTMLInputElement | null;
  if (!form || !input) return () => {};
  const save = form.querySelector(`[id="${form.id}-save"]`) as HTMLButtonElement | null;
  const filename = form.querySelector('input[name="filename"]') as HTMLInputElement | null;
  const data = form.querySelector('input[name="data"]') as HTMLInputElement | null;
  const refused = form.querySelector(".refused");
  let newest = 0;

  const clear = (): void => {
    if (filename) filename.value = "";
    if (data) data.value = "";
    if (save) save.disabled = true;
    writeLine(refused, "");
  };

  const onChange = (): void => {
    clear();
    const file = input.files?.[0];
    const read = ++newest;
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (read !== newest) return;
      const url = typeof reader.result === "string" ? reader.result : "";
      if (filename) filename.value = file.name;
      if (data) data.value = url.slice(url.indexOf(",") + 1);
      if (save) save.disabled = false;
    });
    reader.addEventListener("error", () => {
      if (read !== newest) return;
      clear();
      writeLine(refused, form.dataset.readFailed ?? "");
    });
    reader.readAsDataURL(file);
  };

  input.addEventListener("change", onChange);
  return () => input.removeEventListener("change", onChange);
}
