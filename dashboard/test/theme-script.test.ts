// Spec 107: the one script every page carries — the theme the reader
// chose, applied before the page paints.
//
// `theme-script.ts` can neither import nor export anything (the shell
// transpiles it into an inline classic <script>), so it cannot be
// imported by a test the way every other module here is. It CAN be
// transpiled and run, which is what this file does, against a document
// small enough to state in full: one <html> element, three buttons, and
// the storage the choice is remembered in. The same shape
// `queue-client.test.ts` uses, for the same reason.
//
// Note what the harness does NOT pass in: there is no `location`. A
// script that tried to reload the page to change theme would throw a
// ReferenceError here rather than pass quietly — which is the point of
// criterion 4 ("re-themes immediately with no reload").

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
  readFileSync(join(import.meta.dir, "..", "src", "render", "theme-script.ts"), "utf-8"),
);

interface FakeButton {
  choice: string;
  attrs: Record<string, string>;
}

/** A page with a Theme control and nothing else. `stored` is what
 *  `localStorage` answers with; `storageThrows` is the file:// and
 *  private-browsing case, where reading storage is not an option the
 *  browser offers. */
function harness(opts: { stored?: string | null; storageThrows?: boolean } = {}) {
  const written: [string, string][] = [];
  const localStorage = {
    getItem: (key: string): string | null => {
      if (opts.storageThrows) throw new Error("storage is denied for this origin");
      return key === "theme" ? opts.stored ?? null : null;
    },
    setItem: (key: string, value: string): void => {
      if (opts.storageThrows) throw new Error("storage is denied for this origin");
      written.push([key, value]);
    },
  };

  const root = { dataset: {} as Record<string, string | undefined> };
  const listeners: Record<string, () => void> = {};

  const button = (choice: string, current = false): FakeButton & Record<string, unknown> => {
    const attrs: Record<string, string> = { "data-theme-choice": choice };
    if (current) attrs["aria-current"] = "true";
    return {
      choice,
      attrs,
      getAttribute: (name: string) => attrs[name] ?? null,
      setAttribute: (name: string, value: string) => void (attrs[name] = value),
      removeAttribute: (name: string) => void delete attrs[name],
      addEventListener: (type: string, fn: () => void) =>
        void (listeners[`${choice}:${type}`] = fn),
    };
  };

  // Auto is what the server rendered as chosen: it has no way to know
  // what this reader picked, and Auto is the default.
  const buttons = [button("dark"), button("light"), button("auto", true)];

  // The header trigger's own icon spans (spec 243, revised 2026-08-25):
  // a plain "hidden" attribute, not a class or a swapped icon, so
  // there is nothing script-specific for a fake DOM to fail at.
  const icon = (choice: string, current = false): FakeButton & Record<string, unknown> => {
    const attrs: Record<string, string> = { "data-theme-icon": choice };
    if (!current) attrs["hidden"] = "";
    return {
      choice,
      attrs,
      getAttribute: (name: string) => attrs[name] ?? null,
      setAttribute: (name: string, value: string) => void (attrs[name] = value),
      removeAttribute: (name: string) => void delete attrs[name],
    };
  };
  const icons = [icon("dark"), icon("light"), icon("auto", true)];

  const document = {
    documentElement: root,
    querySelectorAll: (sel: string) =>
      sel.includes("data-theme-choice") ? buttons : sel.includes("data-theme-icon") ? icons : [],
    addEventListener: (type: string, fn: () => void) => void (listeners[`document:${type}`] = fn),
  };

  // eslint-disable-next-line no-new-func -- the file under test IS a script
  new Function("document", "localStorage", SOURCE)(document, localStorage);

  return {
    root,
    written,
    /** The DOM is parsed; whatever the script deferred until then runs now. */
    ready: () => listeners["document:DOMContentLoaded"]!(),
    click: (choice: string) => listeners[`${choice}:click`]!(),
    marked: () => buttons.filter((b) => b.attrs["aria-current"]).map((b) => b.choice),
    /** Which icon span is NOT hidden — the trigger's own visible choice. */
    shownIcon: () => icons.filter((i) => !("hidden" in i.attrs)).map((i) => i.choice),
  };
}

describe("the stored choice, applied on load (criteria 1-3)", () => {
  test("a stored Dark is on the html element before the DOM is even parsed", () => {
    const h = harness({ stored: "dark" });
    // No `ready()` first: this is the whole no-flash claim — the
    // attribute is set while <head> is still being read.
    expect(h.root.dataset.theme).toBe("dark");
  });

  test("a stored Light is applied the same way", () => {
    expect(harness({ stored: "light" }).root.dataset.theme).toBe("light");
  });

  test("no stored choice sets nothing, so the machine's preference still decides", () => {
    expect(harness({ stored: null }).root.dataset.theme).toBeUndefined();
  });

  test("a value nobody wrote is ignored rather than passed on to CSS", () => {
    expect(harness({ stored: "sepia" }).root.dataset.theme).toBeUndefined();
    expect(harness({ stored: "auto" }).root.dataset.theme).toBeUndefined();
  });

  test("storage that throws leaves the page on Auto instead of breaking it", () => {
    const h = harness({ storageThrows: true });
    expect(h.root.dataset.theme).toBeUndefined();
    // And the rest of the script still ran: the buttons are wired.
    expect(() => h.ready()).not.toThrow();
    expect(() => h.click("dark")).not.toThrow();
    expect(h.root.dataset.theme).toBe("dark");
  });

  test("the marker moves to the stored choice once the buttons exist", () => {
    const h = harness({ stored: "light" });
    h.ready();
    expect(h.marked()).toEqual(["light"]);
  });

  test("with no stored choice the marker stays on Auto, where the server put it", () => {
    const h = harness({ stored: null });
    h.ready();
    expect(h.marked()).toEqual(["auto"]);
  });

  test("the trigger's own icon moves to the stored choice too (spec 243)", () => {
    const h = harness({ stored: "light" });
    h.ready();
    expect(h.shownIcon()).toEqual(["light"]);
  });
});

describe("clicking a choice (criterion 4)", () => {
  test("it re-themes at once, remembers the choice, and moves the marker", () => {
    const h = harness({ stored: null });
    h.ready();
    h.click("dark");
    expect(h.root.dataset.theme).toBe("dark");
    expect(h.written).toEqual([["theme", "dark"]]);
    expect(h.marked()).toEqual(["dark"]);
  });

  test("choosing Auto hands the page back to the machine", () => {
    const h = harness({ stored: "dark" });
    h.ready();
    h.click("auto");
    expect(h.root.dataset.theme).toBeUndefined();
    expect(h.written).toEqual([["theme", "auto"]]);
    expect(h.marked()).toEqual(["auto"]);
  });

  test("switching again replaces the choice rather than adding a second one", () => {
    const h = harness({ stored: null });
    h.ready();
    h.click("dark");
    h.click("light");
    expect(h.root.dataset.theme).toBe("light");
    expect(h.marked()).toEqual(["light"]);
  });

  test("the trigger's icon switches on click too, not just the row (spec 243)", () => {
    const h = harness({ stored: null });
    h.ready();
    h.click("dark");
    expect(h.shownIcon()).toEqual(["dark"]);
  });
});
