// The spec drawn inside the open row survives every redraw of the rows: the
// same element comes back, holding what was typed into it. Node identity
// proves it was kept, never markup.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type * as RowSwap from "../../../src/specs-client/row-swap.ts";

const KEY = "aide/81-x";
const OTHER = "aide/82-y";

const head = (key: string, phase: string) =>
  `<tr class="spechead" id="spec-${key}" data-folder="${key}"><td>${key}</td></tr><tr class="subrow"><td>${phase}</td></tr>`;
const gap = `<tr class="specgap"><td></td></tr>`;
const standIn = `<tr class="specdetail" data-spec-detail="${KEY}"><td colspan="6"></td></tr>`;
const filled = `<tr class="specdetail" data-spec-detail="${KEY}"><td colspan="6"><form><textarea name="text">saved</textarea></form></td></tr>`;
const table = (rows: string) =>
  `<div class="tablewrap"><table class="list speclist"><thead><tr><th>Spec</th></tr></thead><tbody>${rows}</tbody></table></div>`;

const group = (key: string, phase: string, detail = "") => head(key, phase) + detail + gap;

/** The module afresh for each test: it remembers the last rows it drew, and
 *  the first redraw after a load is the case under test. */
let loads = 0;
const rowSwap = (): Promise<typeof RowSwap> => import(`../../../src/specs-client/row-swap.ts?load=${++loads}`);

let win: Window;
let mod: typeof RowSwap;
let answer = "";
const asked: string[] = [];
const saved: Record<string, unknown> = {};

/** happy-dom reads the markup `insertAdjacentHTML` is given without a table
 *  around it and drops its `<tr>`s, which a browser keeps. A template parses
 *  rows as rows, so the three positions the row swap uses go through one. */
function parseRowsInContext(window: Window): void {
  const proto = (window as unknown as { HTMLElement: { prototype: Record<string, unknown> } }).HTMLElement.prototype;
  proto.insertAdjacentHTML = function (this: Element, where: string, html: string): void {
    const template = this.ownerDocument.createElement("template");
    template.innerHTML = html;
    const rows = template.content;
    if (where === "beforebegin") this.parentNode!.insertBefore(rows, this);
    else if (where === "beforeend") this.appendChild(rows);
    else if (where === "afterend") this.parentNode!.insertBefore(rows, this.nextSibling);
  };
}

beforeEach(async () => {
  win = new Window();
  parseRowsInContext(win);
  mod = await rowSwap();
  asked.length = 0;
  for (const name of ["document", "location", "fetch"]) saved[name] = (globalThis as Record<string, unknown>)[name];
  Object.assign(globalThis, {
    document: win.document,
    location: { pathname: `/specs/${KEY}`, search: "", href: `http://dash.test/specs/${KEY}` },
    fetch: async (url: string) => {
      asked.push(url);
      return { ok: true, text: async () => answer };
    },
  });
});

afterEach(async () => {
  Object.assign(globalThis, saved);
  await win.happyDOM.close();
});

/** The page as the server first draws it: the open spec in its row. */
function load(): HTMLTextAreaElement {
  win.document.body.innerHTML = `<div id="jobrows">${table(group(KEY, "phase v1", filled) + group(OTHER, "phase v1"))}</div>`;
  const box = win.document.querySelector("textarea") as unknown as HTMLTextAreaElement;
  box.value = "typed after the page opened";
  return box;
}

const detail = () => win.document.querySelector("tr[data-spec-detail]") as unknown as Element | null;

describe("the open spec survives a redraw of the rows (AC-1)", () => {
  test("the first redraw after a load, which replaces all of the rows, keeps the same element and what was typed", async () => {
    const box = load();
    const before = detail();
    answer = table(group(KEY, "phase v1", standIn) + group(OTHER, "phase v1"));
    await mod.swapRows();
    expect(detail() === before).toBe(true);
    expect((win.document.querySelector("textarea") as unknown) === box).toBe(true);
    expect(box.value).toBe("typed after the page opened");
    expect(win.document.querySelectorAll("tr[data-spec-detail]")).toHaveLength(1);
  });

  test("a later redraw that replaces only the open spec's rows keeps it too", async () => {
    const box = load();
    answer = table(group(KEY, "phase v1", standIn) + group(OTHER, "phase v1"));
    await mod.swapRows();
    const before = detail();
    answer = table(group(KEY, "phase v2", standIn) + group(OTHER, "phase v1"));
    await mod.swapRows();
    expect(win.document.body.innerHTML).toContain("phase v2");
    expect(detail() === before).toBe(true);
    expect((win.document.querySelector("textarea") as unknown) === box).toBe(true);
    expect(box.value).toBe("typed after the page opened");
  });

  test("a redraw of that one spec alone keeps it", async () => {
    const box = load();
    answer = table(group(KEY, "phase v1", standIn) + group(OTHER, "phase v1"));
    await mod.swapRows();
    const before = detail();
    answer = `<table><tbody>${group(KEY, "phase v3", standIn)}</tbody></table>`;
    await mod.swapSpec(KEY);
    expect(asked.at(-1)).toContain(`only=${encodeURIComponent(KEY)}`);
    expect(win.document.body.innerHTML).toContain("phase v3");
    expect(detail() === before).toBe(true);
    expect(box.value).toBe("typed after the page opened");
  });

  test("a spec whose row is gone from the answer takes its element with it", async () => {
    load();
    answer = table(group(OTHER, "phase v1"));
    await mod.swapRows();
    expect(detail()).toBeNull();
  });

  test("a page with no open spec is redrawn as before", async () => {
    win.document.body.innerHTML = `<div id="jobrows">${table(group(OTHER, "phase v1"))}</div>`;
    answer = table(group(OTHER, "phase v2"));
    await mod.swapRows();
    expect(win.document.body.innerHTML).toContain("phase v2");
    expect(detail()).toBeNull();
  });
});
