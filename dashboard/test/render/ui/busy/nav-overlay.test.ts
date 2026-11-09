// The loading cover's own script cannot import or export, so it is
// transpiled and run here against a fake document: a press that stands
// while its job is queued asks the cover to show its own word at once,
// and to go once the press is answered.

import { expect, test } from "bun:test";
import { join } from "node:path";

const built = await Bun.build({
  entrypoints: [join(import.meta.dir, "..", "..", "..", "..", "src", "render", "ui", "busy", "nav-overlay.ts")],
  target: "browser", format: "iife",
});
if (!built.success) throw new AggregateError(built.logs, "nav-overlay.ts failed to bundle");
const SOURCE = await built.outputs[0]!.text();

function run() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const note = { textContent: "", hidden: true };
  const dialog = {
    open: false,
    showModal() { dialog.open = true; },
    close() { dialog.open = false; },
    querySelector: () => note,
  };
  const body = { dataset: { overlayNote: "Loading…" }, insertAdjacentHTML() {}, lastElementChild: dialog };
  const doc = { body, addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] ??= []).push(fn) };
  const win = { addEventListener() {} };
  new Function("document", "window", SOURCE)(doc, win);
  const fire = (type: string, detail?: unknown) => { for (const fn of listeners[type] ?? []) fn({ detail }); };
  return { dialog, note, fire };
}

test("a press's cover shows its own word at once, and goes when the press is answered", () => {
  const page = run();
  page.fire("aide-cover", { note: "Deploying…" });
  expect(page.dialog.open).toBe(true);
  expect(page.note.textContent).toBe("Deploying…");
  expect(page.note.hidden).toBe(false);
  page.fire("aide-cover-done");
  expect(page.dialog.open).toBe(false);
});
