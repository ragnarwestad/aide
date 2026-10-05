// The reload from script of a page that waits on something outside the board
// (the Wiki tab's Build panel while a build runs, the Deploy tab waiting for
// origin): every N seconds the page reloads, except that a tick is
// skipped while a dialog is open, so a reason half-typed in Close's box is
// not lost — or while the Wiki tab's own graph is being dragged, panned or
// pinched, so a reload does not reset it under the reader's finger.

/** One tick: reload unless a dialog is open or the wiki graph is active. */
export function reloadTick(doc: Document, reload: () => void): void {
  if (doc.querySelector("dialog[open]")) return;
  if (doc.querySelector("[data-wikigraph][data-active]")) return;
  reload();
}

/** Start the timer from the page's marker, if it has one. */
export function startReloadWhileIdle(doc: Document, reload: () => void = () => location.reload()): void {
  const marker = doc.querySelector("[data-reload-every]");
  const seconds = Number(marker?.getAttribute?.("data-reload-every"));
  if (!seconds) return;
  setInterval(() => reloadTick(doc, reload), seconds * 1000);
}
