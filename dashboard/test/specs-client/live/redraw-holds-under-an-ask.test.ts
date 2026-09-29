// The list's live redraw replaces the rows, and with them any dialog drawn
// inside a row. An ask the reader has open — Reopen, before OK or after a
// refusal — must not vanish under them; Cancel's plain confirm relies on the
// redraw to go away after its OK, so it holds nothing.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { swapRows } from "../../../src/specs-client/row-swap.ts";

const real = {
  document: (globalThis as { document?: unknown }).document,
  location: (globalThis as { location?: unknown }).location,
  fetch: globalThis.fetch,
};
afterEach(() => {
  (globalThis as { document?: unknown }).document = real.document;
  (globalThis as { location?: unknown }).location = real.location;
  globalThis.fetch = real.fetch;
});

/** A page whose `#jobrows` holds `inside`, and a server answering the redraw with new rows. */
function listWith(inside: string): Window {
  const win = new Window();
  win.document.write(`<div id="jobrows">${inside}</div>`);
  (globalThis as { document?: unknown }).document = win.document;
  (globalThis as { location?: unknown }).location = { search: "?state=archived" };
  (globalThis as unknown as { fetch: unknown }).fetch = async () => ({ ok: true, text: async () => "<p>fresh</p>" });
  return win;
}

const rowsOf = (win: Window): string => win.document.getElementById("jobrows")!.innerHTML;

describe("swapRows under an open dialog", () => {
  test("an open ask holds the redraw, and the rows stay as they are (AC-3)", async () => {
    const win = listWith(`<dialog id="reopenask-aide/50" class="confirmdialog" data-progress-dialog open>ask</dialog>`);
    await swapRows();
    const after = rowsOf(win);
    await win.happyDOM.close();
    expect(after).toContain("ask");
    expect(after).not.toContain("fresh");
  });

  test("a closed ask, or Cancel's plain confirm open, lets the redraw go ahead (AC-3)", async () => {
    for (const inside of [
      `<dialog class="confirmdialog" data-progress-dialog>ask</dialog>`,
      `<dialog class="confirmdialog" open>cancel</dialog>`,
    ]) {
      const win = listWith(inside);
      await swapRows();
      const after = rowsOf(win);
      await win.happyDOM.close();
      expect(after).toContain("fresh");
    }
  });
});
