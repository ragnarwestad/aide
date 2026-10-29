import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { harness } from "../fixtures.ts";
import { postForm } from "../../../src/specs-client/press.ts";

// --- A pressed button keeps its width -----------------------------

// --- A press locks the spec ----------------------------------------
//
// A press locks EVERY control on its spec at once — its own button, the
// other buttons, the phase boxes and the model/AI selects on the phase
// lines — and nothing is unlocked until the rows have been redrawn from
// the server. The Run button is written OUTSIDE its form and tied to it
// by `form="…"`, so a lookup of the form's descendants finds nothing to
// lock or to make busy.
describe("a press locks every control on its spec", () => {
  const OK = { ok: true, job: { id: "job-1" } };
  /** Every control the row has, as the press must leave them. */
  const rowState = (h: ReturnType<typeof harness>) => ({
    run: h.runButton.disabled,
    cancel: h.cancelButton.disabled,
    box: h.stepBoxes[0]!.disabled,
    model: h.modelSelects[0]!.disabled,
    ai: h.aiSelects[0]!.disabled,
    otherRow: h.otherRowSelect.disabled,
  });

  // The bug itself, stated as its own case: Run's button is not a
  // descendant of the form it submits, so the old descendants-only
  // lookup could neither disable it nor make it busy.
  test("Run is locked and busy although its button sits outside its form", async () => {
    let seen = { disabled: false, busy: false, title: "" };
    const h = harness((url) => {
      if (url.includes("/api/queue")) {
        seen = {
          disabled: h.runButton.disabled,
          busy: h.runButton.classList.contains("busy"),
          title: h.runButton.title,
        };
      }
      return { ok: true, body: OK };
    }, "rowrun");
    await h.submit();
    expect(seen).toEqual({ disabled: true, busy: true, title: "Starting…" });
  });

  // A form with no row whose button has no word of its own falls back to
  // one — and like every word the component writes, it starts with a
  // capital letter.
  test("a button with no pending word of its own says 'Working…'", async () => {
    let seen = "";
    const h = harness((url) => {
      if (url.includes("/create")) seen = h.createButton.textContent;
      return { ok: true, body: { ok: true } };
    });
    h.createButton.dataset.pending = "";
    await h.submitCreate();
    expect(seen).toBe("Working…");
  });

  // Not "until the answer arrives" — until the row that reflects it is
  // on the screen. The redraw is asked for while everything is still
  // locked.
  test("the row is still locked when the redraw is asked for", async () => {
    let seen = {} as ReturnType<typeof rowState>;
    const h = harness((url) => {
      if (url.includes("rows=1")) seen = rowState(h);
      return { ok: true, body: OK };
    }, "rowrun");
    await h.submit();
    expect(seen.run).toBe(true);
    expect(seen.box).toBe(true);
  });

  // The lock comes AFTER the form has been serialised. A disabled
  // control posts nothing, so locking the boxes first would queue a
  // job with no phases at all — the row's own fields, thrown away by
  // the thing meant to protect them.
  test("the phases still go with the press, although the boxes lock", async () => {
    const h = harness(() => ({ ok: true, body: OK }), "rowrun");
    await h.submit();
    expect(String(h.requests[0]!.init.body)).toContain("steps=analyze");
  });

  // Every control goes back to the state it was FOUND in, not to
  // "enabled": the server draws a row's boxes disabled while a job
  // holds them, and a press that put them back live would offer a
  // choice the server has already refused.
  test("a press that could not be sent puts back exactly what it locked", async () => {
    const h = harness(() => ({ ok: false, throws: true }), "actionform");
    h.stepBoxes[1]!.disabled = true;
    await h.submit();
    expect(rowState(h)).toEqual({
      run: false, cancel: false, box: false, model: false, ai: false, otherRow: false,
    });
    expect(h.stepBoxes[1]!.disabled).toBe(true);
  });

  // What the fallback describes now: a form on no spec row at all —
  // the New-spec page, the Projects panel. Its own button is inside
  // it, and there is nothing to widen the scope to.
  test("a form on no spec row locks its own button and nothing else", async () => {
    let seen = { busy: false, disabled: false, run: false };
    const h = harness(
      (url) => {
        if (url.includes("/api/queue")) {
          seen = {
            busy: h.button.classList.contains("busy"),
            disabled: h.button.disabled,
            run: h.runButton.disabled,
          };
        }
        return { ok: true, body: OK };
      },
      "actionform",
      "",
      { offRow: true },
    );
    await h.submit();
    expect(seen).toEqual({ busy: true, disabled: true, run: false });
    expect(h.button.disabled).toBe(false);
    expect(h.button.classList.contains("busy")).toBe(false);
  });

  // The fold's chevron is a `<a data-nav>` on
  // the same delegated listener. A press must RUN, never open the row
  // underneath the request — and it cannot, structurally: `navigate`
  // acts only on `closest("a[data-nav]")`, which a `<button>` does not
  // match. Asserted rather than assumed, since nothing in the markup
  // says so.
  for (const control of ["rowrun", "actionform"] as const) {
    test(`a press on ${control} does not fold the row open or shut`, () => {
      const h = harness(() => ({ ok: true, body: OK }), control);
      h.click();
      // No history rewrite, so no `?open=` was added or taken away —
      // and no row swap was asked for on the click's own account.
      expect(h.replaced).toEqual([]);
      expect(h.requests).toEqual([]);
    });
  }

  // The control case: the chevron on the SAME listener still folds.
  // Without this the three above would pass just as happily against a
  // listener that had stopped answering clicks at all.
  test("the fold's own chevron still navigates", () => {
    const h = harness(() => ({ ok: true, body: OK }), "rowrun");
    h.clickFold();
    expect(h.replaced).toEqual(["/?open=aide%2F127-one-ai"]);
  });
});

// A Save is out, and the page is looked at meanwhile: real rows in a real
// DOM, since which rows are a spec's is the thing under test.
describe("a Save locks every control on its spec, and only its spec", () => {
  const real = {
    document: (globalThis as { document?: unknown }).document,
    location: (globalThis as { location?: unknown }).location,
    fetch: globalThis.fetch,
    FormData: globalThis.FormData,
  };
  let win: Window | null = null;
  afterEach(async () => {
    (globalThis as { document?: unknown }).document = real.document;
    (globalThis as { location?: unknown }).location = real.location;
    globalThis.fetch = real.fetch;
    globalThis.FormData = real.FormData;
    await win?.happyDOM.close();
    win = null;
  });

  const head = (key: string) => `<tr class="spechead" id="spec-${key}"><td><a href="#">${key}</a></td></tr>`;
  const gap = `<tr class="specgap" aria-hidden="true"><td></td></tr>`;
  const checks = (key: string) =>
    `<tr class="specnotice"><td><form class="rowchecks" id="rowchecks-${key}" method="post" action="http://dash.test/api/specs/${key}/checks">` +
    `<input type="hidden" name="phase" value="x"><input type="checkbox" name="tick" value="AC-1">` +
    `<button type="submit" class="btn primary" id="checks-save-${key}">Save</button></form></td></tr>`;
  const caption = (key: string) =>
    `<tr class="subrow" data-caption><td>` +
    `<form class="rowrun" id="rowrun-${key}" method="post" action="http://dash.test/api/queue"><input type="hidden" name="spec" value="${key}"></form>` +
    `<button type="submit" form="rowrun-${key}" class="btn primary">Run</button>` +
    `<select form="rowrun-${key}" name="ai.analyze"><option>claude</option></select>` +
    `<select form="rowrun-${key}" name="model.analyze"><option>opus</option></select></td></tr>` +
    `<tr class="subrow"><td><input type="checkbox" form="rowrun-${key}" name="steps" value="analyze" checked>` +
    `<input type="checkbox" form="rowrun-${key}" name="steps" value="implement"></td></tr>`;
  const depends = (key: string) =>
    `<tr class="subrow" data-depends-line><td><form class="dependsform" id="depends-${key}" method="post" action="http://dash.test/api/specs/${key}/depends">` +
    `<input type="checkbox" name="dependsOn" value="aide/9-z"><button type="submit" class="btn primary" id="depends-save-${key}">Save</button>` +
    `<button type="button" class="btn" id="depends-cancel-${key}">Cancel</button></form></td></tr>`;
  /** The open spec's detail row: its own update form, a Close button and
   *  the Description tab's form inside a table of its own. */
  const detail = (key: string) =>
    `<tr class="specdetail"><td><form class="reloadform" id="update-${key}" method="post" action="http://dash.test/api/specs/${key}/update">` +
    `<button type="submit" class="btn">Update</button></form><button type="button" class="btn">Close</button>` +
    `<table><tbody><tr><td><form class="specform" id="desc-${key}" method="post" action="http://dash.test/api/specs/${key}/file">` +
    `<textarea name="text">old</textarea><button type="submit" class="btn primary" id="desc-save-${key}">Save</button>` +
    `<button type="button" class="btn">Cancel</button></form></td></tr></tbody></table></td></tr>`;

  const running = (key: string) => head(key) + caption(key) + depends(key) + checks(key) + gap;
  const listed = (key: string) => head(key) + checks(key) + detail(key) + gap;

  /** The page, with a fetch that stays open until `answer` is called. */
  function page(rows: string) {
    win = new Window({ url: "http://dash.test/" });
    win.document.write(`<div id="jobrows"><table><tbody>${rows}</tbody></table></div>`);
    (globalThis as { document?: unknown }).document = win.document;
    (globalThis as { location?: unknown }).location = win.location;
    (globalThis as unknown as { FormData: unknown }).FormData = win.FormData;
    let answer: (r: { ok: boolean; body: unknown }) => void = () => {};
    const held = new Promise<{ ok: boolean; body: unknown }>((resolve) => { answer = resolve; });
    globalThis.fetch = (async () => {
      const r = await held;
      return { ok: r.ok, status: r.ok ? 200 : 409, json: async () => r.body };
    }) as unknown as typeof fetch;
    return { doc: win.document as unknown as Document, answer };
  }

  const PRESSABLE = "button, select, textarea, input:not([type=hidden])";
  /** Every control on one spec's rows: its head row and the rows after it
   *  up to the next spec's, with nested tables. */
  function controlsOf(doc: Document, key: string): (HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[] {
    const out: Element[] = [];
    for (let el: Element | null = doc.getElementById(`spec-${key}`); el; el = el.nextElementSibling) {
      if (el.className === "spechead" && el.id !== `spec-${key}`) break;
      out.push(...Array.from(el.querySelectorAll(PRESSABLE)));
    }
    return out as never;
  }
  const disabledOf = (els: { disabled: boolean }[]) => els.map((el) => el.disabled);
  const press = (doc: Document, id: string) => {
    const save = doc.getElementById(id) as HTMLButtonElement;
    const sent = postForm(save.closest("form")!, () => {}, () => {});
    return { save, sent };
  };

  const pages = {
    "the Running tab": { rows: () => running("aide/a") + running("aide/b"), saves: ["checks-save-aide/a", "depends-save-aide/a"] },
    "the Specs list": { rows: () => listed("aide/a") + listed("aide/b"), saves: ["checks-save-aide/a", "desc-save-aide/a"] },
  };

  for (const [name, { rows, saves }] of Object.entries(pages)) {
    for (const saveId of saves) {
      test(`on ${name}, ${saveId} locks all of spec A and none of spec B while it is out (AC-1, AC-2, AC-3)`, async () => {
        const { doc, answer } = page(rows());
        const a = controlsOf(doc, "aide/a");
        const b = controlsOf(doc, "aide/b");
        expect(a.length).toBeGreaterThan(5);
        const bBefore = disabledOf(b);
        const { save, sent } = press(doc, saveId);
        expect(disabledOf(a).every(Boolean)).toBe(true);
        expect(disabledOf(b)).toEqual(bBefore);
        expect(save.classList.contains("busy")).toBe(true);
        expect(save.classList.contains("primary")).toBe(false);
        answer({ ok: true, body: { ok: true } });
        await sent;
        expect(save.classList.contains("busy")).toBe(false);
        expect(save.classList.contains("primary")).toBe(true);
      });
    }
  }

  for (const [label, reply] of [
    ["succeeded with nothing redrawn", { ok: true, body: { ok: true } }],
    ["was refused", { ok: false, body: { ok: false, error: "no" } }],
  ] as const) {
    test(`when the answer ${label}, every control is as it was found (AC-4)`, async () => {
      const { doc, answer } = page(running("aide/a") + running("aide/b"));
      const a = controlsOf(doc, "aide/a");
      // One phase box and Depends on's Cancel are drawn disabled: the
      // answer leaves them so.
      (doc.querySelector('input[name="steps"][value="implement"]') as HTMLInputElement).disabled = true;
      (doc.getElementById("depends-cancel-aide/a") as HTMLButtonElement).disabled = true;
      const before = disabledOf(a);
      const { sent } = press(doc, "checks-save-aide/a");
      const run = a.find((el) => el.textContent === "Run")!;
      expect(run.disabled).toBe(true);
      answer(reply);
      await sent;
      expect(disabledOf(a)).toEqual(before);
      expect(run.disabled).toBe(false);
      expect(before.filter(Boolean)).toHaveLength(2);
    });
  }
});
