// A refused press on the Specs list says why under the spec it was
// pressed for, and the page script keeps that sentence itself: it is
// written at once, put back after every redraw of the rows, and gone once
// another press starts. A refusal naming no spec on the list goes into
// the list's own line above the rows.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { listRefusalLine, refusalRowTemplate } from "../../../src/render/pages/specs-list/notice-row.ts";
import { clearRefusal } from "../../../src/specs-client/row-refusal";
import { showRefusal } from "../../../src/specs-client/tail-actions.ts";
import { submitAction } from "../../../src/specs-client/forms.ts";
import { swapRows } from "../../../src/specs-client/row-swap.ts";
import { confirmDialog } from "../../../src/render/ui/components";

const real = {
  document: (globalThis as { document?: unknown }).document,
  location: (globalThis as { location?: unknown }).location,
  fetch: globalThis.fetch,
  FormData: globalThis.FormData,
  history: (globalThis as { history?: unknown }).history,
};
let win: Window | null = null;
afterEach(async () => {
  clearRefusal();
  (globalThis as { document?: unknown }).document = real.document;
  (globalThis as { location?: unknown }).location = real.location;
  (globalThis as { history?: unknown }).history = real.history;
  globalThis.fetch = real.fetch;
  globalThis.FormData = real.FormData;
  await win?.happyDOM.close();
  win = null;
});

const group = (key: string, extra = "") =>
  `<tr class="spechead" id="spec-${key}" data-folder="${key.split("/")[1]}"><td>${key}${extra}</td></tr>` +
  `<tr class="specgap" aria-hidden="true"><td colspan="6"></td></tr>`;

const CANCEL = confirmDialog("en", {
  id: "cancelask-j1",
  title: "Cancel Implement?",
  ok: { variant: "primary" },
  post: { action: "/api/queue/j1/cancel", hook: "actionform" },
});

/** The list's rows. A different `drawn` redraws the whole table rather
 *  than one spec's rows, which is the path a stand-in document parses
 *  (it drops a `<tr>` handed to `insertAdjacentHTML`). */
const rows = (drawn: number, a = "", b = "") =>
  `<div class="tablewrap" data-drawn="${drawn}"><table><tbody>${group("aide/a", a)}${group("aide/b", b)}</tbody></table></div>`;

/** The list as the server draws it: the line above the rows, the row the
 *  script copies, and `#jobrows`; `answer` is what the rows' redraw gets. */
function list(inside: string, answer: { rows: () => string; press?: { status: number; body: unknown } }) {
  win = new Window({ url: "http://dash.test/?state=active" });
  win.document.write(`${listRefusalLine()}${refusalRowTemplate()}<div id="jobrows">${inside}</div>`);
  (globalThis as { document?: unknown }).document = win.document;
  (globalThis as { location?: unknown }).location = win.location;
  (globalThis as { history?: unknown }).history = { replaceState() { throw new Error("the address is not written"); } };
  (globalThis as unknown as { FormData: unknown }).FormData = win.FormData;
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
    if (url.includes("rows=1")) return { ok: true, text: async () => answer.rows() };
    const press = answer.press ?? { status: 200, body: { ok: true } };
    return { ok: press.status < 400, status: press.status, json: async () => press.body };
  };
  return win.document as unknown as Document;
}

const refusalRows = (doc: Document) => Array.from(doc.querySelectorAll("tr[data-refusal]"));
const words = (el: Element | null | undefined) => el?.querySelector("span")?.textContent ?? "";

describe("a refused press on the list", () => {
  test("is written under its spec at once, before the group's gap (AC-6)", async () => {
    const doc = list(rows(1), { rows: () => new Promise<string>(() => {}) as unknown as string });
    void showRefusal("the job is already done", "aide/a");
    const [row] = refusalRows(doc);
    expect(words(row)).toBe("The job is already done");
    expect(row!.nextElementSibling?.className).toBe("specgap");
    expect(row!.previousElementSibling?.id).toBe("spec-aide/a");
  });

  test("stays through a redraw that replaces its spec's rows and one that leaves them (AC-6)", async () => {
    let fresh = rows(2);
    const doc = list(rows(2), { rows: () => fresh });
    await swapRows();
    await showRefusal("the job is already done", "aide/a");
    expect(refusalRows(doc)).toHaveLength(1);
    fresh = rows(3, " changed");
    await swapRows();
    expect(refusalRows(doc).map(words)).toEqual(["The job is already done"]);
    await swapRows();
    expect(refusalRows(doc).map(words)).toEqual(["The job is already done"]);
    expect(refusalRows(doc)[0]!.previousElementSibling?.id).toBe("spec-aide/a");
  });

  test("is gone once another press starts (AC-6)", async () => {
    const doc = list(rows(4), { rows: () => rows(4) });
    await showRefusal("the job is already done", "aide/a");
    doc.getElementById("spec-aide/b")!.insertAdjacentHTML(
      "beforeend",
      `<td><form class="actionform" method="post" action="/api/queue/j2/cancel"><button>Cancel</button></form></td>`,
    );
    const form = doc.querySelector("form.actionform") as unknown as HTMLFormElement;
    const event = { target: form, defaultPrevented: false, preventDefault() { event.defaultPrevented = true; } };
    await submitAction(event as unknown as Event);
    expect(refusalRows(doc)).toHaveLength(0);
  });

  test("closes the confirm dialog its form was posted from (AC-6)", async () => {
    const reason = "the job is already done; only a queued or running job can be cancelled";
    const doc = list(rows(5, CANCEL), { rows: () => rows(5, CANCEL), press: { status: 409, body: { error: reason, spec: "aide/a" } } });
    const dialog = doc.getElementById("cancelask-j1") as unknown as HTMLDialogElement;
    dialog.setAttribute("open", "");
    const form = dialog.querySelector("form") as unknown as HTMLFormElement;
    const event = { target: form, defaultPrevented: false, preventDefault() { event.defaultPrevented = true; } };
    await submitAction(event as unknown as Event);
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(refusalRows(doc).map(words)).toEqual(["The job is already done; only a queued or running job can be cancelled"]);
  });

  test("naming no spec, goes into the list's own line, which a redraw leaves (AC-6)", async () => {
    const doc = list(rows(6), { rows: () => rows(7, " changed") });
    await showRefusal("no such message", undefined);
    expect(refusalRows(doc)).toHaveLength(0);
    expect(words(doc.getElementById("list-refused"))).toBe("No such message");
    await swapRows();
    expect(words(doc.getElementById("list-refused"))).toBe("No such message");
  });

  test("names a spec not on the list, and is shown nowhere (AC-2)", async () => {
    const doc = list(rows(8), { rows: () => rows(8) });
    await showRefusal("the job is already done", "aide/zz");
    expect(refusalRows(doc)).toHaveLength(0);
    expect(words(doc.getElementById("list-refused"))).toBe("");
  });
});
