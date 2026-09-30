// The one opener: a click on any button naming a dialog opens that dialog,
// for every confirmation that has a button, on a row drawn after the
// listener was bound too.

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { openAsk } from "../../../src/specs-client/ask.ts";
import { renderSpecsRows } from "../../../src/render";
import { scheduleControlCells } from "../../../src/render/pages/schedule-page/controls.ts";
import { openKeys, row } from "../../render/pages/fixtures.ts";

const click = (el: unknown) => ({ target: el }) as unknown as Event;
const isOpen = (doc: { getElementById(id: string): unknown }, id: string): boolean =>
  !!(doc.getElementById(id) as HTMLDialogElement | null)?.open;

/** A running row on the specs list, as the renderer draws it. */
const runningRows = (id: string): string => {
  const folder = `105-${id}`;
  const r = row({ id, specFolder: folder, steps: ["implement"], stepIndex: 0, state: "running" });
  const targets = [{ project: "aide", specFolder: folder }];
  return renderSpecsRows(
    [r],
    { runnerAvailable: true, targets, filter: { open: openKeys([r], targets) }, modelChoices: [{ name: "sonnet" }] },
    Date.parse("2026-08-19T12:00:00Z"),
  );
};

describe("openAsk", () => {
  const page = () => {
    const win = new Window();
    win.document.write(
      `<button type="button" id="b" data-ask="x">Reopen</button>` +
        `<button type="button" id="gone" data-ask="nowhere">Close</button>` +
        `<button type="button" id="plain">Update</button>` +
        `<dialog id="x"><form method="dialog"><button>Cancel</button></form></dialog>`,
    );
    return win;
  };

  test("a click on a button[data-ask] shows the dialog it names as a modal (AC-2)", async () => {
    const win = page();
    openAsk(click(win.document.getElementById("b")));
    const open = isOpen(win.document, "x");
    await win.happyDOM.close();
    expect(open).toBe(true);
  });

  test("a click inside the button reaches it too (AC-2)", async () => {
    const win = page();
    const doc = win.document;
    doc.getElementById("b")!.innerHTML = "<span>Reopen</span>";
    openAsk(click(doc.querySelector("#b span")));
    const open = isOpen(doc, "x");
    await win.happyDOM.close();
    expect(open).toBe(true);
  });

  test("a click outside such a button, or on one naming a missing dialog, opens nothing (AC-2)", async () => {
    const win = page();
    const doc = win.document;
    openAsk(click(doc.getElementById("plain")));
    openAsk(click(doc.getElementById("gone")));
    openAsk(click(null));
    const open = isOpen(doc, "x");
    await win.happyDOM.close();
    expect(open).toBe(false);
  });

  test("Delete on a schedule row opens its own dialog, found by an id holding a slash (AC-2)", async () => {
    const win = new Window();
    const entry = (name: string) => ({ name, cron: "0 3 * * *", prompt: "x", enabled: true });
    win.document.write(
      `<table><tbody><tr>${scheduleControlCells("aide", entry("a"))}</tr>` +
        `<tr>${scheduleControlCells("aide", entry("b"))}</tr></tbody></table>`,
    );
    const button = win.document.querySelector(`button[data-ask="deleteask-aide/b"]`);
    openAsk(click(button));
    const opened = ["a", "b"].map((n) => isOpen(win.document, `deleteask-aide/${n}`));
    await win.happyDOM.close();
    expect(button).not.toBeNull();
    expect(opened).toEqual([false, true]);
  });

  test("a row redrawn after the listener was bound still opens its dialog (AC-2)", async () => {
    const win = new Window();
    const doc = win.document;
    doc.write(`<table><tbody id="jobrows">${runningRows("j1")}</tbody></table>`);
    doc.body.addEventListener("click", openAsk as unknown as Parameters<typeof doc.body.addEventListener>[1]);
    // The live redraw replaces the rows wholesale, dialogs and buttons alike.
    doc.getElementById("jobrows")!.innerHTML = runningRows("j2");
    (doc.querySelector(`button[data-ask="cancelask-j2"]`) as unknown as HTMLButtonElement | null)?.click();
    const open = isOpen(doc, "cancelask-j2");
    await win.happyDOM.close();
    expect(open).toBe(true);
  });
});
