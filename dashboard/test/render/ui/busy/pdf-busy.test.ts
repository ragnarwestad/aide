// The PDF button: it looks pressed the moment it is clicked, and clears
// when the reader is back on this tab (spec 358, REQ-6).
//
// `pdf-busy.ts` can neither import nor export anything — the shell
// transpiles it into the same inline classic <script> as its siblings —
// so, like them, it is transpiled and run here against a document (and,
// like nav-overlay.ts, a window) small enough to state in full.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
  readFileSync(join(import.meta.dir, "..", "..", "..", "..", "src", "render", "ui", "busy", "pdf-busy.ts"), "utf-8"),
);

function harness() {
  const classes = new Set<string>();
  const html: string[] = [];
  const link = {
    classList: {
      add: (c: string) => void classes.add(c),
      remove: (c: string) => void classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    insertAdjacentHTML: (_where: string, markup: string) => void html.push(markup),
    querySelector: (sel: string) => (sel === ".spin" && html.length > 0 ? { remove: () => void html.pop() } : null),
  };
  let clickHandler: ((event: unknown) => void) | undefined;
  const document = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (type === "click") clickHandler = fn;
    },
  };
  let focusHandler: (() => void) | undefined;
  const window = {
    addEventListener: (type: string, fn: () => void) => {
      if (type === "focus") focusHandler = fn;
    },
    removeEventListener: (type: string) => {
      if (type === "focus") focusHandler = undefined;
    },
  };
  new Function("document", "window", SOURCE)(document, window);

  const click = (
    target: { closest?: (sel: string) => unknown } | null,
    extra: Partial<{ defaultPrevented: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; button: number }> = {},
  ) =>
    clickHandler!({
      target,
      defaultPrevented: extra.defaultPrevented ?? false,
      metaKey: extra.metaKey ?? false,
      ctrlKey: extra.ctrlKey ?? false,
      shiftKey: extra.shiftKey ?? false,
      button: extra.button ?? 0,
    });

  const linkTarget = { closest: (sel: string) => (sel === "a[data-pdf]" ? link : null) };
  const focus = () => focusHandler?.();

  return { click, linkTarget, link, classes, html, focus, hasFocusListener: () => !!focusHandler };
}

describe("spec 358: the PDF button looks pressed the moment it is clicked", () => {
  test("a plain click adds busy and one spinner", () => {
    const h = harness();
    h.click(h.linkTarget);
    expect(h.classes.has("busy")).toBe(true);
    expect(h.html).toEqual(['<span class="spin" aria-hidden="true"></span>']);
  });

  test("a second click while already busy does nothing", () => {
    const h = harness();
    h.click(h.linkTarget);
    h.click(h.linkTarget);
    expect(h.html).toHaveLength(1);
  });

  test("focus on window clears the busy look", () => {
    const h = harness();
    h.click(h.linkTarget);
    expect(h.classes.has("busy")).toBe(true);
    h.focus();
    expect(h.classes.has("busy")).toBe(false);
    expect(h.html).toHaveLength(0);
  });

  test("a click that lands nowhere near a[data-pdf] adds nothing", () => {
    const h = harness();
    h.click({ closest: () => null });
    expect(h.classes.size).toBe(0);
    expect(h.hasFocusListener()).toBe(false);
  });

  test("a modifier or non-primary click is left alone", () => {
    const h = harness();
    h.click(h.linkTarget, { metaKey: true });
    h.click(h.linkTarget, { ctrlKey: true });
    h.click(h.linkTarget, { shiftKey: true });
    h.click(h.linkTarget, { button: 1 });
    expect(h.classes.size).toBe(0);
  });

  test("a click already spoken for is left alone", () => {
    const h = harness();
    h.click(h.linkTarget, { defaultPrevented: true });
    expect(h.classes.size).toBe(0);
  });
});
