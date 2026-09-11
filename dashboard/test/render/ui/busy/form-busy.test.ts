// The Save on a page that posts a real form: it looks pressed the
// moment it is pressed, and it cannot be pressed twice.
//
// `form-busy.ts` can neither import nor export anything — the shell
// transpiles it into the same inline classic <script> as the theme and
// unit scripts — so, like them, it is transpiled and run here against a
// document small enough to state in full.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
  readFileSync(join(import.meta.dir, "..", "..", "..", "..", "src", "render", "ui", "busy", "form-busy.ts"), "utf-8"),
);

function harness() {
  const classes = new Set(["btn", "primary"]);
  const html: string[] = [];
  const attrs: Record<string, string> = {};
  const button = {
    tagName: "BUTTON",
    title: "",
    dataset: { pending: "saving…" } as Record<string, string>,
    classList: {
      add: (c: string) => void classes.add(c),
      remove: (c: string) => void classes.delete(c),
    },
    setAttribute: (name: string, value: string) => void (attrs[name] = value),
    insertAdjacentHTML: (_where: string, markup: string) => void html.push(markup),
  };
  const form = {
    tagName: "FORM",
    dataset: {} as Record<string, string>,
    querySelector: (sel: string) => (sel === "button[type=submit]" ? button : null),
  };
  let handler: ((event: unknown) => void) | undefined;
  const document = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (type === "submit") handler = fn;
    },
  };
  new Function("document", SOURCE)(document);
  /** One press. `owned` is a form some other script has already taken
   *  (it called preventDefault on its way past). */
  const press = (opts: { owned?: boolean; submitter?: unknown } = {}) => {
    let prevented = opts.owned ?? false;
    handler!({
      target: form,
      submitter: "submitter" in opts ? opts.submitter : button,
      defaultPrevented: opts.owned ?? false,
      preventDefault: () => void (prevented = true),
    });
    return prevented;
  };
  return { press, classes, html, attrs, button, form };
}

describe("a pressed Save looks pressed", () => {
  test("the button goes busy, keeps its word, and gains one spinner", () => {
    const h = harness();
    h.press();
    expect([...h.classes].sort()).toEqual(["btn", "busy"]);
    expect(h.attrs["aria-busy"]).toBe("true");
    // The pending word costs no width in the title; the label is
    // untouched, so the button does not grow and shove its row.
    expect(h.button.title).toBe("saving…");
    expect(h.html).toEqual(['<span class="spin" aria-hidden="true"></span>']);
  });

  test("a second press is refused rather than sent", () => {
    const h = harness();
    h.press();
    expect(h.press()).toBe(true);
    // Still one spinner, not two.
    expect(h.html).toHaveLength(1);
  });

  // `queue-client.ts` marks its own buttons busy after intercepting the
  // press. Marking them again here would put a second spinner in them.
  test("a form another script has already taken is left alone", () => {
    const h = harness();
    h.press({ owned: true });
    expect(h.html).toEqual([]);
    expect([...h.classes].sort()).toEqual(["btn", "primary"]);
    expect(h.form.dataset.busy).toBeUndefined();
  });

  // Enter from inside a field: the browser reports no submitter, and
  // the form's own submit button is the one that would have been used.
  test("Enter in a field marks the form's own submit button", () => {
    const h = harness();
    h.press({ submitter: null });
    expect([...h.classes].sort()).toEqual(["btn", "busy"]);
  });

  // The entry list is built AFTER this event, so a control disabled
  // here posts nothing. The flag on the form is the guard instead.
  test("nothing is disabled, so nothing drops out of the payload", () => {
    expect(SOURCE).not.toContain("disabled = true");
  });
});
