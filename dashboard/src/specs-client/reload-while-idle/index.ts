// The Steps tab's reload, from script, and the only one a page that ships
// the script has: every N seconds the page reloads, except that a tick is
// skipped while a dialog is open, so a reason half-typed in Close's box is
// not lost.

/** One tick: reload unless a dialog is open. */
export function reloadTick(doc: Document, reload: () => void): void {
  if (doc.querySelector("dialog[open]")) return;
  reload();
}

/** Start the timer from the page's marker, if it has one. */
export function startReloadWhileIdle(doc: Document, reload: () => void = () => location.reload()): void {
  const marker = doc.querySelector("[data-reload-every]");
  const seconds = Number(marker?.getAttribute?.("data-reload-every"));
  if (!seconds) return;
  setInterval(() => reloadTick(doc, reload), seconds * 1000);
}
