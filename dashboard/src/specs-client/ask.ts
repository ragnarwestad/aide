// The one opener every confirmation on the board shares (`confirmDialog()`,
// render/ui/components): a button carrying `data-ask="<dialog id>"` names
// its dialog, and a click on it opens that dialog as a modal. Bound once,
// on `body`, so a list row drawn by a later redraw reaches it too.

/** A click on any `button[data-ask]` opens the dialog it names. The id
 *  is looked up with `getElementById`, never a CSS `#…` selector: a
 *  schedule entry's (`deleteask-<project>/<name>`) holds a `/`. */
export function openAsk(event: Event): void {
  const button = (event.target as Element | null)?.closest?.("button[data-ask]") as HTMLButtonElement | null;
  const id = button?.dataset.ask;
  const box = id ? (button!.ownerDocument.getElementById(id) as HTMLDialogElement | null) : null;
  if (box && typeof box.showModal === "function") box.showModal();
}
