import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { bindLimits, drawLimits, refreshLimit } from "../../../src/specs-client/limits";

type Field = HTMLInputElement | HTMLTextAreaElement;

let win: Window | undefined;
afterEach(async () => {
  await win?.happyDOM.close();
  win = undefined;
});

/** A page with one Title, one Description and a Close reason, script bound. */
function load(body = "", opts: { title?: string; description?: string } = {}) {
  win = new Window();
  win.document.write(
    `<form>` +
      `<input type="text" name="title" maxlength="120" value="${opts.title ?? ""}">` +
      `<textarea name="description" maxlength="5000">${opts.description ?? ""}</textarea>` +
      `<textarea name="reason" data-maxlength="5000"></textarea>` +
      `</form>${body}`,
  );
  const doc = win.document as unknown as Document;
  bindLimits(doc);
  const q = <T extends Field>(name: string) => doc.querySelector(`[name="${name}"]`) as unknown as T;
  return { win, doc, title: q<HTMLInputElement>("title"), description: q<HTMLTextAreaElement>("description"), reason: q<HTMLTextAreaElement>("reason") };
}

const count = (f: Field) => f.nextElementSibling as HTMLElement;
const note = (f: Field) => count(f).nextElementSibling as HTMLElement;
const tick = () => new Promise<void>((r) => setTimeout(r, 5));
const fire = (w: Window, target: Field, type: string, extra: object = {}) => {
  const e = new w.Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, extra);
  target.dispatchEvent(e as unknown as Event);
};
const type = (w: Window, f: Field, value: string) => {
  f.value = value;
  fire(w, f, "input");
};
/** A paste as a browser makes it: the event, then the insertion it allows. */
async function paste(w: Window, f: Field, text: string, kept: string, sel: [number, number] = [f.value.length, f.value.length]) {
  f.setSelectionRange(sel[0], sel[1]);
  fire(w, f, "paste", { clipboardData: { getData: () => text } });
  f.value = f.value.slice(0, sel[0]) + kept + f.value.slice(sel[1]);
  fire(w, f, "input");
  await tick();
}

describe("the count", () => {
  test("is drawn at load, prefilled text included, and follows typing (AC-1)", () => {
    const h = load("", { title: "x".repeat(40) });
    expect(count(h.title).textContent).toBe("40 of 120 characters");
    expect(count(h.description).textContent).toBe("0 of 5000 characters");
    type(h.win, h.title, "hello");
    expect(count(h.title).textContent).toBe("5 of 120 characters");
  });

  test("carries ok and near as the field fills (AC-4)", () => {
    const h = load();
    type(h.win, h.title, "x".repeat(107));
    expect(count(h.title).dataset.limit).toBe("ok");
    type(h.win, h.title, "x".repeat(108));
    expect(count(h.title).dataset.limit).toBe("near");
    expect(count(h.title).textContent).toBe("108 of 120 characters, 12 left");
    type(h.win, h.description, "x".repeat(4499));
    expect(count(h.description).dataset.limit).toBe("ok");
    type(h.win, h.description, "x".repeat(4500));
    expect(count(h.description).dataset.limit).toBe("near");
  });

  test("a field bounded by data-maxlength gets that bound applied (AC-6)", () => {
    const h = load();
    expect(h.reason.maxLength).toBe(5000);
    expect(count(h.reason).textContent).toBe("0 of 5000 characters");
  });

  test("a value the script writes itself reaches the count, with no input event (AC-1, AC-6)", () => {
    win = new Window();
    win.document.write(
      `<form class="addprojectform">` +
        `<input type="text" name="specsPath" maxlength="300">` +
        `<input type="text" name="worktreeLinks" maxlength="300"></form>`,
    );
    const doc = win.document as unknown as Document;
    bindLimits(doc);
    const form = doc.querySelector("form") as unknown as HTMLFormElement;
    const specs = form.querySelector('[name="specsPath"]') as unknown as Field;
    // Written by the script, not typed: no `input` event is fired, and
    // the count has to follow anyway.
    (specs as unknown as HTMLInputElement).value = "y".repeat(40);
    refreshLimit(specs as unknown as HTMLInputElement);
    expect(count(specs).textContent).toBe("40 of 300 characters");
  });
});

describe("the discarded-text line", () => {
  test("after a paste the field cut, says how many did not fit (AC-2)", async () => {
    const h = load("", { description: "x".repeat(4950) });
    await paste(h.win, h.description, "y".repeat(100), "y".repeat(50));
    expect(note(h.description).textContent).toContain("50 characters did not fit");
    expect(note(h.description).textContent).toContain("5000");
    expect(count(h.description).textContent).toBe("5000 of 5000 characters, 0 left");
    expect(note(h.description).getAttribute("role")).toBe("status");
  });

  test("a paste over a selection counts what the selection made room for (AC-2)", async () => {
    const h = load("", { title: "x".repeat(100) });
    await paste(h.win, h.title, "y".repeat(60), "y".repeat(50), [10, 40]);
    expect(note(h.title).textContent).toContain("10 characters did not fit");
    h.title.value = "x".repeat(100);
    await paste(h.win, h.title, "y".repeat(50), "y".repeat(50), [10, 40]);
    expect(note(h.title).textContent).toBe("");
  });

  test("a pair of units that could not be cut in half still leaves the field one under and is reported (AC-2)", async () => {
    const h = load("", { title: "x".repeat(118) });
    await paste(h.win, h.title, "a😀b", "a");
    expect(h.title.value.length).toBe(119);
    expect(note(h.title).textContent).toContain("3 characters did not fit");
  });

  test("a pasted text with CRLF line breaks is measured as LF (AC-2)", async () => {
    const h = load("", { description: "x".repeat(4990) });
    // "a\r\nb\r\nc" is 7 units, 5 once folded; the field takes all 5 and ends at 4995.
    await paste(h.win, h.description, "a\r\nb\r\nc", "a\nb\nc");
    expect(note(h.description).textContent).toBe("");
  });

  test("a drop from outside is reported; a drop of text dragged within the same field is not (AC-2)", async () => {
    const h = load("", { description: "x".repeat(5000) });
    fire(h.win, h.description, "drop", { dataTransfer: { getData: () => "z".repeat(30) } });
    await tick();
    expect(note(h.description).textContent).toContain("30 characters did not fit");
    type(h.win, h.description, "x".repeat(4999));
    expect(note(h.description).textContent).toBe("");
    type(h.win, h.description, "x".repeat(5000));
    fire(h.win, h.description, "dragstart");
    fire(h.win, h.description, "drop", { dataTransfer: { getData: () => "z".repeat(30) } });
    await tick();
    expect(note(h.description).textContent).toBe("");
  });

  test("a cancelled drag does not hide a later drop from outside (AC-2)", async () => {
    const h = load("", { description: "x".repeat(5000) });
    fire(h.win, h.description, "dragstart");
    fire(h.win, h.description, "dragend");
    fire(h.win, h.description, "drop", { dataTransfer: { getData: () => "z".repeat(30) } });
    await tick();
    expect(note(h.description).textContent).toContain("30 characters did not fit");
  });

  test("goes when one character is deleted, but stays through an edit that keeps the length (AC-3)", async () => {
    const h = load("", { description: "x".repeat(4950) });
    await paste(h.win, h.description, "y".repeat(100), "y".repeat(50));
    expect(note(h.description).textContent).not.toBe("");
    type(h.win, h.description, "z".repeat(5000));
    expect(note(h.description).textContent).not.toBe("");
    type(h.win, h.description, "z".repeat(4999));
    expect(note(h.description).textContent).toBe("");
  });

  test("goes when a later paste is not cut (AC-3)", async () => {
    const h = load("", { description: "x".repeat(4950) });
    await paste(h.win, h.description, "y".repeat(100), "y".repeat(50));
    expect(note(h.description).textContent).not.toBe("");
    h.description.value = "x".repeat(100);
    await paste(h.win, h.description, "y".repeat(10), "y".repeat(10));
    expect(note(h.description).textContent).toBe("");
  });

  test("the Close reason reports an overflowing paste the way the Description does (AC-6)", async () => {
    const h = load();
    await paste(h.win, h.reason, "y".repeat(5100), "y".repeat(5000));
    expect(note(h.reason).textContent).toContain("100 characters did not fit");
  });
});

describe("drawLimits (spec 522)", () => {
  const FIELD = '<textarea class="failnote" name="failnote-0" maxlength="500"></textarea>';

  test("called twice on one root leaves one count and one note per field (AC-4)", () => {
    const { doc } = load();
    drawLimits(doc);
    drawLimits(doc);
    for (const name of ["title", "description", "reason"]) {
      const f = doc.querySelector(`[name="${name}"]`) as unknown as Field;
      expect(count(f).hasAttribute("data-limit")).toBe(true);
      expect(note(f).hasAttribute("data-limit-note")).toBe(true);
      expect(note(f).nextElementSibling?.hasAttribute("data-limit")).not.toBe(true);
    }
  });

  test("a field added after bindLimits is counted once by drawLimits(container) (AC-4)", () => {
    const { doc } = load('<div id="late"></div>');
    const box = doc.getElementById("late")!;
    box.innerHTML = FIELD;
    drawLimits(box);
    drawLimits(box);
    const f = box.querySelector("textarea") as unknown as Field;
    expect(count(f).textContent).toBe("0 of 500 characters");
    expect(box.querySelectorAll("[data-limit]")).toHaveLength(1);
    expect(box.querySelectorAll("[data-limit-note]")).toHaveLength(1);
  });
});
