// A press on a shut › on the Specs list opens that row in place: the page is
// never replaced, so what the press leaves alone is the same element after it.
// Node identity and the requests made prove it; no markup is compared.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type * as Open from "../../../src/specs-client/spec-detail/open.ts";

let counter = 0;
let loads = 0;
/** The module afresh for each test: it remembers the press in flight and the address last drawn. */
const openModule = (): Promise<typeof Open> => import(`../../../src/specs-client/spec-detail/open.ts?load=${++loads}`);

let win: Window;
let mod: typeof Open;
let A: string;
let B: string;
let C: string;

const asked: string[] = [];
const pushed: string[] = [];
const assigned: string[] = [];
const reloads: number[] = [];
const saved: Record<string, unknown> = {};
interface Held { resolve: (r: unknown) => void; reject: (e: unknown) => void; aborted: boolean }
let held: Held[] = [];
const answer = (body: string, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => body });

const link = (key: string, open: boolean) =>
  `<a class="fold${open ? "" : " shut"}" data-goto href="${open ? "/specs?q=x" : `/specs/${key}?q=x`}#spec-${key}" aria-expanded="${open}"></a>`;
const head = (key: string, open: boolean) =>
  `<tr class="spechead" id="spec-${key}" data-folder="${key}"><td>${link(key, open)}</td></tr>`;
const gap = `<tr class="specgap"><td></td></tr>`;
const detailRow = (key: string, inner: string) =>
  `<tr class="specdetail" data-spec-detail="${key}"><td colspan="6">${inner}</td></tr>`;
const shutGroup = (key: string) => head(key, false) + gap;
const openGroup = (key: string, inner: string) => head(key, true) + detailRow(key, inner) + gap;
const table = (rows: string) => `<table><tbody>${rows}</tbody></table>`;

/** What the server answers for the whole list at an address: the spec the address names open, as its stand-in. */
const wholeList = (open?: string) =>
  table([A, B, C].map((k) => (k === open ? openGroup(k, "") : shutGroup(k))).join(""));

/** happy-dom drops the `<tr>`s of markup inserted without a table around it, which a browser keeps. */
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

const place = (url: string): void => {
  const u = new URL(url, "http://dash.test");
  Object.assign(globalThis.location, { pathname: u.pathname, search: u.search, hash: u.hash, href: u.href });
};

beforeEach(async () => {
  counter++;
  [A, B, C] = ["a", "b", "c"].map((s) => `aide/${counter}${s}-spec`) as [string, string, string];
  win = new Window({ settings: { disableJavaScriptFileLoading: true, disableJavaScriptEvaluation: true } });
  parseRowsInContext(win);
  mod = await openModule();
  const { specLoadingRowTemplate } = await import("../../../src/render/pages/specs-list/notice-row.ts");
  asked.length = pushed.length = assigned.length = reloads.length = 0;
  held = [];
  for (const name of ["document", "location", "fetch", "history", "Event"]) saved[name] = (globalThis as Record<string, unknown>)[name];
  Object.assign(globalThis, {
    document: win.document,
    Event: win.Event,
    location: {
      pathname: "/specs", search: "?q=x", hash: "", href: "http://dash.test/specs?q=x",
      assign: (to: string) => { assigned.push(to); },
      reload: () => { reloads.push(1); },
    },
    history: {
      replaceState: () => {},
      pushState: (_s: unknown, _t: string, url: string) => { pushed.push(url); place(url); },
    },
    fetch: (url: string, init?: { signal?: AbortSignal }) => {
      asked.push(url);
      const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
      if (params.get("detail")) {
        return new Promise((resolve, reject) => {
          const gate: Held = { resolve, reject, aborted: false };
          init?.signal?.addEventListener("abort", () => { gate.aborted = true; reject(new Error("aborted")); });
          held.push(gate);
        });
      }
      const only = params.get("only");
      const open = [A, B, C].find((k) => location.pathname === `/specs/${k}`);
      return Promise.resolve(answer(only ? table(only === open ? openGroup(only, "") : shutGroup(only)) : wholeList(open)));
    },
  });
  win.document.body.innerHTML =
    `<div id="jobrows"><div class="tablewrap"><table class="list speclist"><tbody>` +
    `${shutGroup(A)}${shutGroup(B)}${shutGroup(C)}</tbody></table></div></div>` +
    specLoadingRowTemplate(6, "en");
  win.document.getElementById("jobrows")!.addEventListener("click", (e) => { taken = mod.openSpecInPlace(e as unknown as MouseEvent); });
});

afterEach(async () => {
  Object.assign(globalThis, saved);
  await win.happyDOM.close();
});

let taken: boolean | null = null;

const headRow = (key: string) => win.document.getElementById(`spec-${key}`) as unknown as Element;
const chevron = (key: string) => headRow(key).querySelector("a.fold") as unknown as HTMLAnchorElement;
const details = () => Array.from(win.document.querySelectorAll("tr[data-spec-detail]")) as unknown as Element[];
const inert = () => win.document.body.hasAttribute("inert");
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

function press(key: string, init: Record<string, unknown> = {}): MouseEvent {
  taken = null;
  const event = new win.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  chevron(key).dispatchEvent(event as unknown as Event);
  return event as unknown as MouseEvent;
}

/** A spec open in its row, with the answer already in. */
async function openAndSettle(key: string, inner = "<p>the spec</p>"): Promise<void> {
  press(key);
  held[held.length - 1]!.resolve(answer(table(openGroup(key, inner))));
  await settle();
  held = [];
  asked.length = pushed.length = 0;
}

const unsavedIn = (key: string): void => {
  detailRowOf(key).querySelector("td")!.insertAdjacentHTML("beforeend", `<form class="specform"><button id="specform-save" type="submit">Save</button></form>`);
};
const detailRowOf = (key: string) => details().find((d) => d.getAttribute("data-spec-detail") === key)!;

describe("a press on a shut › opens the row in place (AC-1, AC-2)", () => {
  test("the press is taken, nothing else on the page is replaced, and the address pushed is the chevron's href (AC-1)", () => {
    const others = [headRow(A), headRow(C), win.document.querySelector(".tablewrap")];
    const href = chevron(B).getAttribute("href")!;
    const event = press(B);
    expect(taken).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(pushed).toEqual([href]);
    const now = [headRow(A), headRow(C), win.document.querySelector(".tablewrap")];
    expect(now.map((el, i) => el === others[i])).toEqual([true, true, true]);
    expect(chevron(B).getAttribute("aria-expanded")).toBe("true");
  });

  test("a click the browser should handle itself is left to it (AC-1)", () => {
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) {
      const event = press(B, init);
      expect([taken, event.defaultPrevented]).toEqual([false, false]);
    }
    expect([asked, pushed]).toEqual([[], []]);
  });

  test("an open spec's own › is left to the browser, which loads the list (AC-1)", async () => {
    await openAndSettle(B);
    const event = press(B);
    expect([taken, event.defaultPrevented]).toEqual([false, false]);
  });

  test("a spec open with no unsaved change is shut in place, its rows asked for again, and the new one opened (AC-1)", async () => {
    await openAndSettle(A);
    const oldDetail = detailRowOf(A);
    press(B);
    expect(oldDetail.isConnected).toBe(false);
    expect(chevron(A).getAttribute("aria-expanded")).toBe("false");
    expect(chevron(B).getAttribute("aria-expanded")).toBe("true");
    expect(details().map((d) => d.getAttribute("data-spec-detail"))).toEqual([B]);
    await settle();
    expect(asked.some((u) => u.includes("rows=1") && u.includes(`only=${encodeURIComponent(A)}`))).toBe(true);
    held[0]!.resolve(answer(table(openGroup(B, "<p>b</p>"))));
    await settle();
    expect(details().map((d) => d.getAttribute("data-spec-detail"))).toEqual([B]);
    expect(chevron(A).getAttribute("aria-expanded")).toBe("false");
  });

  test("a spec open with an unsaved change leaves the press to the browser and asks for nothing (AC-1)", async () => {
    await openAndSettle(A);
    unsavedIn(A);
    const event = press(B);
    expect([taken, event.defaultPrevented]).toEqual([false, false]);
    expect([asked, pushed]).toEqual([[], []]);
    expect(detailRowOf(A).isConnected).toBe(true);
  });

  test("a page without the loading row leaves the press to the browser (AC-1)", () => {
    win.document.getElementById("spec-loading-row")!.remove();
    const event = press(B);
    expect([taken, event.defaultPrevented]).toEqual([false, false]);
  });
});

describe("while the spec is on its way (AC-2, AC-3)", () => {
  test("the page has one detail row, keyed to the pressed spec, before its gap row, holding the Loading line (AC-2)", () => {
    press(B);
    const rows = details();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute("data-spec-detail")).toBe(B);
    expect(rows[0]!.nextElementSibling!.className).toBe("specgap");
    expect(rows[0]!.previousElementSibling).toBe(headRow(B) as never);
    expect(rows[0]!.textContent).toContain("Loading …");
    expect(win.document.body.textContent!.match(/Loading …/g)).toHaveLength(1);
  });

  test("the page cannot be pressed, and a request is on its way for the spec alone (AC-3)", () => {
    press(B);
    expect(inert()).toBe(true);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(`/specs/${B}?`);
    expect(asked[0]).toContain("detail=1");
  });
});

describe("when the spec arrives (AC-4)", () => {
  test("its rows are the answer's, the Loading line is gone, the page can be pressed, the event is sent and the script added (AC-4)", async () => {
    let drawn = 0;
    win.document.addEventListener(mod.SPEC_DETAIL_DRAWN, () => { drawn++; });
    press(B);
    held[0]!.resolve(answer(table(openGroup(B, "<p>the spec</p>")) + `<script src="/spec-editor.js"></script>`));
    await settle();
    expect(details().map((d) => d.getAttribute("data-spec-detail"))).toEqual([B]);
    expect(detailRowOf(B).textContent).toContain("the spec");
    expect(win.document.body.textContent).not.toContain("Loading …");
    expect(chevron(B).getAttribute("aria-expanded")).toBe("true");
    expect(chevron(B).getAttribute("href")).toBe("/specs?q=x#spec-" + B);
    expect(inert()).toBe(false);
    expect(drawn).toBe(1);
    expect(Array.from(win.document.querySelectorAll("script[src]")).map((s) => s.getAttribute("src"))).toEqual(["/spec-editor.js"]);
  });

  test("the rest of the list is asked for again for the new address once it has settled (AC-4)", async () => {
    press(B);
    held[0]!.resolve(answer(table(openGroup(B, "<p>the spec</p>"))));
    await settle();
    expect(asked.some((u) => u.includes("rows=1") && !u.includes("only=") && u.includes(`/specs/${B}?`))).toBe(true);
    expect(details().map((d) => d.getAttribute("data-spec-detail"))).toEqual([B]);
  });
});

describe("when the spec cannot be loaded (AC-5)", () => {
  const failures: [string, () => void][] = [
    ["a non-2xx answer", () => held[0]!.resolve(answer("nope", 500))],
    ["a rejected request", () => held[0]!.reject(new Error("offline"))],
    ["an answer with no detail row", () => held[0]!.resolve(answer(table(shutGroup(B))))],
  ];
  for (const [name, fail] of failures) {
    test(`${name}: the row says so and not Loading, the page can be pressed, and the spec's rows are asked for again (AC-5)`, async () => {
      press(B);
      fail();
      await settle();
      const cell = detailRowOf(B).textContent!;
      expect(cell).toContain("could not be loaded");
      expect(cell).not.toContain("Loading");
      expect(details()).toHaveLength(1);
      expect(inert()).toBe(false);
      expect(asked.some((u) => u.includes("rows=1") && u.includes(`only=${encodeURIComponent(B)}`))).toBe(true);
    });
  }
});

describe("Back (AC-1)", () => {
  /** The page as Back finds it: the handler bound at load, on the list's address. */
  function bound(): () => void {
    const handlers: (() => void)[] = [];
    mod.bindBack({ location: { pathname: "/specs" }, addEventListener: (_n: string, h: () => void) => { handlers.push(h); } });
    return () => handlers.forEach((h) => h());
  }

  test("to the list shuts the open row at once, in place (AC-1)", async () => {
    const back = bound();
    await openAndSettle(B);
    const row = headRow(B);
    place("/specs?q=x");
    back();
    expect(details()).toHaveLength(0);
    expect(chevron(B).getAttribute("aria-expanded")).toBe("false");
    expect(headRow(B) === (row as never)).toBe(true);
    expect([assigned, reloads]).toEqual([[], []]);
  });

  test("while the answer is held aborts the request and lifts the lock, and the late answer draws nothing (AC-1)", async () => {
    const back = bound();
    press(B);
    place("/specs?q=x");
    back();
    await settle();
    expect(held[0]!.aborted).toBe(true);
    expect(inert()).toBe(false);
    held[0]!.resolve(answer(table(openGroup(B, "<p>late</p>"))));
    await settle();
    expect(win.document.body.textContent).not.toContain("late");
    expect(details()).toHaveLength(0);
  });

  test("with the open spec's Save active puts the spec's address back and loads the list, so the leave question asks (AC-1)", async () => {
    const back = bound();
    await openAndSettle(B);
    unsavedIn(B);
    const spec = location.pathname + location.search + location.hash;
    place("/specs?q=x");
    pushed.length = 0;
    back();
    expect(pushed).toEqual([spec]);
    expect(assigned).toEqual(["/specs?q=x"]);
    expect(detailRowOf(B).isConnected).toBe(true);
  });

  test("to another spec's address loads that page (AC-1)", async () => {
    const back = bound();
    await openAndSettle(B);
    place(`/specs/${A}?q=x`);
    back();
    expect(reloads).toEqual([1]);
  });

  test("with only the hash changed does nothing (AC-1)", async () => {
    const back = bound();
    await openAndSettle(B);
    place(`/specs/${B}?q=x#other`);
    back();
    expect([reloads, assigned]).toEqual([[], []]);
    expect(details()).toHaveLength(1);
  });
});
