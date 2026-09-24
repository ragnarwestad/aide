// The settings table's textareas: they fit their content, save on Enter
// and never hold a line break.
import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { bindOneLineFields, foldLineBreaks } from "../../src/specs-client/forms.ts";
import { oneLine } from "../../src/project/project-admin/manifest-io.ts";

let win: Window | undefined;
afterEach(async () => {
  await win?.happyDOM.close();
  win = undefined;
  delete (globalThis as { window?: unknown }).window;
});

function load(saveDisabled = false) {
  win = new Window();
  win.document.write(
    `<form><textarea name="specsPath" data-oneline rows="1"></textarea>` +
      `<button type="submit"${saveDisabled ? " disabled" : ""}>Save</button></form>`,
  );
  (globalThis as { window?: unknown }).window = win;
  const form = win.document.querySelector("form") as unknown as HTMLFormElement;
  const field = form.querySelector("textarea") as HTMLTextAreaElement;
  let scroll = 20;
  Object.defineProperty(field, "scrollHeight", { get: () => scroll });
  const submits: number[] = [];
  (form as { requestSubmit: () => void }).requestSubmit = () => void submits.push(1);
  const heights: string[] = [];
  const style = field.style;
  const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(style), "height");
  Object.defineProperty(style, "height", {
    get: () => original?.get?.call(style),
    set: (v: string) => {
      heights.push(v);
      original?.set?.call(style, v);
    },
  });
  bindOneLineFields(form);
  const key = (extra: object = {}) => {
    const e = new win!.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(e, { key: "Enter", ...extra });
    field.dispatchEvent(e as unknown as Event);
    return e as unknown as Event;
  };
  return { win, form, field, submits, heights, key, setScroll: (n: number) => (scroll = n) };
}

describe("height", () => {
  test("goes to auto, then to the content's height, when bound, on input and on resize (AC-2)", () => {
    const t = load();
    expect(t.heights).toEqual(["auto", "20px"]);
    t.setScroll(60);
    t.field.value = "x";
    t.field.dispatchEvent(new t.win.Event("input") as unknown as Event);
    expect(t.heights.slice(-2)).toEqual(["auto", "60px"]);
    t.setScroll(40);
    (globalThis as unknown as { window: Window }).window.dispatchEvent(new t.win.Event("resize"));
    expect(t.heights.slice(-2)).toEqual(["auto", "40px"]);
  });
});

describe("Enter", () => {
  test("saves once, with or without a modifier, and adds no break (AC-3)", () => {
    const t = load();
    for (const extra of [{}, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(t.key(extra).defaultPrevented).toBe(true);
    }
    expect(t.submits).toHaveLength(5);
  });

  test("does nothing but prevent the break while Save is disabled or the key repeats (AC-3)", () => {
    const busy = load(true);
    expect(busy.key().defaultPrevented).toBe(true);
    expect(busy.submits).toHaveLength(0);
    const held = load();
    expect(held.key({ repeat: true }).defaultPrevented).toBe(true);
    expect(held.submits).toHaveLength(0);
  });

  test("does nothing at all during an IME composition (AC-3)", () => {
    const t = load();
    expect(t.key({ isComposing: true }).defaultPrevented).toBe(false);
    expect(t.key({ keyCode: 229 }).defaultPrevented).toBe(false);
    expect(t.submits).toHaveLength(0);
  });
});

describe("a line break", () => {
  test("is folded to a space when text is filled, keeping the caret's distance from the end (AC-3)", () => {
    const t = load();
    t.field.value = "a\r\nbcd";
    t.field.setSelectionRange(5, 5);
    t.field.dispatchEvent(new t.win.Event("input") as unknown as Event);
    expect(t.field.value).toBe("a bcd");
    expect(t.field.selectionEnd).toBe(4);
  });

  test("is folded the same way in the browser and on the server (AC-3)", () => {
    for (const input of ["a\r\nb", " a\nb ", "a  \n\n  b", "plain", "a\rb\nc", ""]) {
      expect(oneLine(input)).toBe(foldLineBreaks(input).trim());
    }
  });
});
