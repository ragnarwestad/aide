// A row › changes the address and draws its row again. An answer asked
// before that — the list's live redraw, or the same row's earlier press —
// arrives later on a slow board, and must not draw the row back the way it
// was: a job's row then shut itself again a moment after it was opened.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type * as RowSwap from "../../../src/specs-client/row-swap/index.ts";

const KEY = "aide/81-x";

const group = (state: string) =>
  `<tr class="spechead" id="spec-${KEY}" data-folder="${KEY}"><td>${state}</td></tr><tr class="specgap"><td></td></tr>`;
/** One spec alone, as the server answers a row's own ›. */
const one = (state: string) => `<table><tbody>${group(state)}</tbody></table>`;
const table = (rows: string) =>
  `<div class="tablewrap"><table class="list"><thead><tr><th>Job</th></tr></thead><tbody>${rows}</tbody></table></div>`;

let loads = 0;
const rowSwap = (): Promise<typeof RowSwap> => import(`../../../src/specs-client/row-swap/index.ts?load=${++loads}`);

/** One fetch held until the test answers it. */
interface Held { url: string; answer(html: string): Promise<void> }

let win: Window;
let mod: typeof RowSwap;
let held: Held[] = [];
const saved: Record<string, unknown> = {};
const location = { pathname: "/jobs", search: "?state=active", href: "http://dash.test/jobs?state=active" };

beforeEach(async () => {
  win = new Window();
  const proto = (win as unknown as { HTMLElement: { prototype: Record<string, unknown> } }).HTMLElement.prototype;
  proto.insertAdjacentHTML = function (this: Element, where: string, html: string): void {
    const template = this.ownerDocument.createElement("template");
    template.innerHTML = html;
    if (where === "beforebegin") this.parentNode!.insertBefore(template.content, this);
    else if (where === "beforeend") this.appendChild(template.content);
    else if (where === "afterend") this.parentNode!.insertBefore(template.content, this.nextSibling);
  };
  mod = await rowSwap();
  held = [];
  location.search = "?state=active";
  for (const name of ["document", "location", "fetch"]) saved[name] = (globalThis as Record<string, unknown>)[name];
  Object.assign(globalThis, {
    document: win.document,
    location,
    fetch: (url: string) => new Promise((resolve) => {
      held.push({
        url,
        // The answer is drawn after the caller's own awaits; a few turns of
        // the loop are enough for it to land.
        answer: async (html) => {
          resolve({ ok: true, text: async () => html });
          for (let i = 0; i < 20; i++) await Promise.resolve();
        },
      });
    }),
  });
  win.document.body.innerHTML = `<div id="jobrows">${table(group("shut"))}</div>`;
});

afterEach(async () => {
  Object.assign(globalThis, saved);
  await win.happyDOM.close();
});

const shown = (): string => win.document.getElementById(`spec-${KEY}`)?.textContent ?? "";

test("a live redraw asked before a row was opened does not draw it shut again", async () => {
  const redraw = mod.swapRows();
  location.search = `?state=active&open=${encodeURIComponent(KEY)}`;
  const press = mod.swapSpec(KEY);
  await held[1]!.answer(one("open"));
  await press;
  await held[0]!.answer(table(group("shut")));
  await redraw;
  expect(shown()).toBe("open");
});

test("a row's earlier press answering last does not undo its later one", async () => {
  location.search = `?state=active&open=${encodeURIComponent(KEY)}`;
  const first = mod.swapSpec(KEY);
  location.search = "?state=active";
  const second = mod.swapSpec(KEY);
  await held[1]!.answer(one("shut"));
  await second;
  await held[0]!.answer(one("open"));
  await first;
  expect(shown()).toBe("shut");
});

test("a live redraw asked for the address the page still has is drawn", async () => {
  const redraw = mod.swapRows();
  await held[0]!.answer(table(group("redrawn")));
  await redraw;
  expect(shown()).toBe("redrawn");
});
