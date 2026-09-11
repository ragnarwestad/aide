// A link that leaves the page for another document: it looks pressed
// the moment it is clicked, on every page.
//
// `nav-busy.ts` can neither import nor export anything — the shell
// transpiles it into the same inline classic <script> as the theme and
// form-busy scripts — so, like them, it is transpiled and run here
// against a document small enough to state in full.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
  readFileSync(join(import.meta.dir, "..", "..", "..", "..", "src", "render", "ui", "busy", "nav-busy.ts"), "utf-8"),
);

function harness() {
  const classes = new Set<string>();
  const link = {
    classList: {
      add: (c: string) => void classes.add(c),
    },
  };
  const other = {};
  let handler: ((event: unknown) => void) | undefined;
  const document = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (type === "click") handler = fn;
    },
  };
  new Function("document", SOURCE)(document);
  const click = (target: unknown, extra: Partial<{ defaultPrevented: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; button: number }> = {}) =>
    handler!({
      target,
      defaultPrevented: extra.defaultPrevented ?? false,
      metaKey: extra.metaKey ?? false,
      ctrlKey: extra.ctrlKey ?? false,
      shiftKey: extra.shiftKey ?? false,
      button: extra.button ?? 0,
    });
  return { click, classes, link, other };
}

describe("a link that leaves the page looks pressed the moment it is clicked", () => {
  test("a plain click on a[data-goto] adds awaiting", () => {
    const h = harness();
    const link = { closest: (sel: string) => (sel.includes("data-goto") ? h.link : null) };
    h.click(link);
    expect(h.classes.has("awaiting")).toBe(true);
  });

  test("a click that lands nowhere near such a link adds nothing", () => {
    const h = harness();
    const target = { closest: () => null };
    h.click(target);
    expect(h.classes.size).toBe(0);
  });

  test("a modifier click is left alone", () => {
    const h = harness();
    const link = { closest: (sel: string) => (sel.includes("data-goto") ? h.link : null) };
    h.click(link, { metaKey: true });
    h.click(link, { ctrlKey: true });
    h.click(link, { shiftKey: true });
    h.click(link, { button: 1 });
    expect(h.classes.size).toBe(0);
  });

  test("a click already spoken for is left alone", () => {
    const h = harness();
    const link = { closest: (sel: string) => (sel.includes("data-goto") ? h.link : null) };
    h.click(link, { defaultPrevented: true });
    expect(h.classes.size).toBe(0);
  });
});
