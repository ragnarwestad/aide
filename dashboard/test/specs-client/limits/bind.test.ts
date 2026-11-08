import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  bindLimits,
  drawLimits,
  refreshLimit,
} from "../../../src/specs-client/limits";

type Field = HTMLInputElement | HTMLTextAreaElement;

let win: Window | undefined;
afterEach(async () => {
  await win?.happyDOM.close();
  win = undefined;
});

/** A page with one Title, a field cut at 5,000, a Description that is counted and never cut, and a Close reason, script bound. */
function load(
  body = "",
  opts: { title?: string; body?: string; bound?: string } = {},
) {
  win = new Window();
  win.document.write(
    `<form>` +
      `<input type="text" name="title" maxlength="120" value="${opts.title ?? ""}">` +
      `<textarea name="body" maxlength="5000">${opts.body ?? ""}</textarea>` +
      `<textarea name="description" data-bound="10000">${opts.bound ?? ""}</textarea>` +
      `<textarea name="reason" data-maxlength="5000"></textarea>` +
      `</form>${body}`,
  );
  const doc = win.document as unknown as Document;
  bindLimits(doc);
  const q = <T extends Field>(name: string) =>
    doc.querySelector(`[name="${name}"]`) as unknown as T;
  return {
    win,
    doc,
    title: q<HTMLInputElement>("title"),
    body: q<HTMLTextAreaElement>("body"),
    description: q<HTMLTextAreaElement>("description"),
    reason: q<HTMLTextAreaElement>("reason"),
  };
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
async function paste(
  w: Window,
  f: Field,
  text: string,
  kept: string,
  sel: [number, number] = [f.value.length, f.value.length],
) {
  f.setSelectionRange(sel[0], sel[1]);
  fire(w, f, "paste", { clipboardData: { getData: () => text } });
  f.value = f.value.slice(0, sel[0]) + kept + f.value.slice(sel[1]);
  fire(w, f, "input");
  await tick();
}

describe("the count", () => {
  test("is drawn at load, prefilled text included, and follows typing", () => {
    const h = load("", { title: "x".repeat(40) });
    expect(count(h.title).textContent).toBe("40 of 120 characters");
    expect(count(h.body).textContent).toBe("0 of 5000 characters");
    type(h.win, h.title, "hello");
    expect(count(h.title).textContent).toBe("5 of 120 characters");
  });

  test("a field bounded by data-maxlength gets that bound applied", () => {
    const h = load();
    expect(h.reason.maxLength).toBe(5000);
    expect(count(h.reason).textContent).toBe("0 of 5000 characters");
  });

  test("a value the script writes itself reaches the count, with no input event", () => {
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
  test("after a paste the field cut, says how many did not fit", async () => {
    const h = load("", { body: "x".repeat(4950) });
    await paste(h.win, h.body, "y".repeat(100), "y".repeat(50));
    expect(note(h.body).textContent).toContain("50 characters did not fit");
    expect(note(h.body).textContent).toContain("5000");
    expect(count(h.body).textContent).toBe("5000 of 5000 characters, 0 left");
    expect(note(h.body).getAttribute("role")).toBe("status");
  });

  test("a paste over a selection counts what the selection made room for", async () => {
    const h = load("", { title: "x".repeat(100) });
    await paste(h.win, h.title, "y".repeat(60), "y".repeat(50), [10, 40]);
    expect(note(h.title).textContent).toContain("10 characters did not fit");
    h.title.value = "x".repeat(100);
    await paste(h.win, h.title, "y".repeat(50), "y".repeat(50), [10, 40]);
    expect(note(h.title).textContent).toBe("");
  });

  test("a pair of units that could not be cut in half still leaves the field one under and is reported", async () => {
    const h = load("", { title: "x".repeat(118) });
    await paste(h.win, h.title, "a😀b", "a");
    expect(h.title.value.length).toBe(119);
    expect(note(h.title).textContent).toContain("3 characters did not fit");
  });

  test("a pasted text with CRLF line breaks is measured as LF", async () => {
    const h = load("", { body: "x".repeat(4990) });
    // "a\r\nb\r\nc" is 7 units, 5 once folded; the field takes all 5 and ends at 4995.
    await paste(h.win, h.body, "a\r\nb\r\nc", "a\nb\nc");
    expect(note(h.body).textContent).toBe("");
  });

  test("a drop from outside is reported; a drop of text dragged within the same field is not", async () => {
    const h = load("", { body: "x".repeat(5000) });
    fire(h.win, h.body, "drop", {
      dataTransfer: { getData: () => "z".repeat(30) },
    });
    await tick();
    expect(note(h.body).textContent).toContain("30 characters did not fit");
    type(h.win, h.body, "x".repeat(4999));
    expect(note(h.body).textContent).toBe("");
    type(h.win, h.body, "x".repeat(5000));
    fire(h.win, h.body, "dragstart");
    fire(h.win, h.body, "drop", {
      dataTransfer: { getData: () => "z".repeat(30) },
    });
    await tick();
    expect(note(h.body).textContent).toBe("");
  });

  test("a cancelled drag does not hide a later drop from outside", async () => {
    const h = load("", { body: "x".repeat(5000) });
    fire(h.win, h.body, "dragstart");
    fire(h.win, h.body, "dragend");
    fire(h.win, h.body, "drop", {
      dataTransfer: { getData: () => "z".repeat(30) },
    });
    await tick();
    expect(note(h.body).textContent).toContain("30 characters did not fit");
  });

  test("goes when one character is deleted, but stays through an edit that keeps the length", async () => {
    const h = load("", { body: "x".repeat(4950) });
    await paste(h.win, h.body, "y".repeat(100), "y".repeat(50));
    expect(note(h.body).textContent).not.toBe("");
    type(h.win, h.body, "z".repeat(5000));
    expect(note(h.body).textContent).not.toBe("");
    type(h.win, h.body, "z".repeat(4999));
    expect(note(h.body).textContent).toBe("");
  });

  test("goes when a later paste is not cut", async () => {
    const h = load("", { body: "x".repeat(4950) });
    await paste(h.win, h.body, "y".repeat(100), "y".repeat(50));
    expect(note(h.body).textContent).not.toBe("");
    h.body.value = "x".repeat(100);
    await paste(h.win, h.body, "y".repeat(10), "y".repeat(10));
    expect(note(h.body).textContent).toBe("");
  });

  test("the Close reason reports an overflowing paste the way the Description does", async () => {
    const h = load();
    await paste(h.win, h.reason, "y".repeat(5100), "y".repeat(5000));
    expect(note(h.reason).textContent).toContain("100 characters did not fit");
  });
});

describe("a field bounded by data-bound is counted and never cut", () => {
  const over = (n: number) => "x".repeat(10000 + n);

  test("carries no maxLength, and the count reads against the bound it names (AC-2, AC-3)", () => {
    const h = load("", { bound: "x".repeat(37) });
    expect(h.description.hasAttribute("maxlength")).toBe(false);
    expect(h.description.maxLength).toBe(-1);
    expect(count(h.description).textContent).toBe("37 of 10000 characters");
  });

  test("past the bound the count is over, the field invalid and the note says how many too many (AC-4)", () => {
    const h = load();
    type(h.win, h.description, over(120));
    expect(count(h.description).getAttribute("data-limit")).toBe("over");
    expect(h.description.getAttribute("aria-invalid")).toBe("true");
    expect(note(h.description).textContent).toContain("120");
    expect(
      (h.description.form as unknown as HTMLFormElement).checkValidity(),
    ).toBe(false);
  });

  test("shortened to the bound, the mark, the note and the hold are gone (AC-4)", () => {
    const h = load();
    type(h.win, h.description, over(120));
    type(h.win, h.description, "x".repeat(10000));
    expect(count(h.description).getAttribute("data-limit")).not.toBe("over");
    expect(h.description.hasAttribute("aria-invalid")).toBe(false);
    expect(note(h.description).textContent).toBe("");
    expect(
      (h.description.form as unknown as HTMLFormElement).checkValidity(),
    ).toBe(true);
  });

  test("a further paste keeps all of it and leaves the over sentence in place (AC-2, AC-4)", async () => {
    const h = load("", { bound: over(20) });
    refreshLimit(h.description);
    await paste(h.win, h.description, "y".repeat(100), "y".repeat(100));
    expect(h.description.value.length).toBe(10120);
    expect(note(h.description).textContent).toContain("120");
    expect(h.description.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("drawLimits", () => {
  const FIELD =
    '<textarea class="failnote" name="failnote-0" maxlength="500"></textarea>';

  test("called twice on one root leaves one count and one note per field", () => {
    const { doc } = load();
    drawLimits(doc);
    drawLimits(doc);
    for (const name of ["title", "body", "description", "reason"]) {
      const f = doc.querySelector(`[name="${name}"]`) as unknown as Field;
      expect(count(f).hasAttribute("data-limit")).toBe(true);
      expect(note(f).hasAttribute("data-limit-note")).toBe(true);
      expect(note(f).nextElementSibling?.hasAttribute("data-limit")).not.toBe(
        true,
      );
    }
  });

  test("a field added after bindLimits is counted once by drawLimits(container)", () => {
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
