// Spec 118: the second half of the one script every page carries — the
// UNIT the reader wants consumption in, dollars or tokens.
//
// `unit-script.ts` is `theme-script.ts`'s sibling in every way that
// matters here: it can neither import nor export anything (the shell
// transpiles it into the same inline classic <script>), so it cannot be
// imported by a test the way every other module is. It CAN be transpiled
// and run, which is what this file does, against a document small enough
// to state in full.
//
// Note what the harness does NOT pass in: there is no `location`. A
// script that reloaded the page to change unit would throw a
// ReferenceError here rather than pass quietly — the same guarantee
// theme-script.test.ts gets from the same omission.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
  readFileSync(join(import.meta.dir, "..", "src", "render", "unit-script.ts"), "utf-8"),
);

interface FakeButton {
  choice: string;
  attrs: Record<string, string>;
}

/** A page with a Units control and nothing else. `stored` is what
 *  `localStorage` answers with; `storageThrows` is the file:// and
 *  private-browsing case, where reading storage is not an option the
 *  browser offers. */
function harness(opts: { stored?: string | null; storageThrows?: boolean } = {}) {
  const written: [string, string][] = [];
  const localStorage = {
    getItem: (key: string): string | null => {
      if (opts.storageThrows) throw new Error("storage is denied for this origin");
      return key === "unit" ? opts.stored ?? null : null;
    },
    setItem: (key: string, value: string): void => {
      if (opts.storageThrows) throw new Error("storage is denied for this origin");
      written.push([key, value]);
    },
  };

  const root = { dataset: {} as Record<string, string | undefined> };
  const listeners: Record<string, () => void> = {};

  const button = (choice: string, current = false): FakeButton & Record<string, unknown> => {
    const attrs: Record<string, string> = { "data-unit-choice": choice };
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

  // Dollars is what the server rendered as chosen: it has no way to know
  // what this reader picked, and dollars is what every page said before
  // this control existed.
  const buttons = [button("usd", true), button("tokens")];

  const document = {
    documentElement: root,
    querySelectorAll: (sel: string) => (sel.includes("data-unit-choice") ? buttons : []),
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
  };
}

describe("the stored unit, applied on load (criterion 5)", () => {
  test("a stored Tokens is on the html element before the DOM is even parsed", () => {
    // No `ready()` first: this is the whole no-flash claim — the
    // attribute is set while <head> is still being read, so a reader on
    // tokens never sees a dollar figure first.
    expect(harness({ stored: "tokens" }).root.dataset.unit).toBe("tokens");
  });

  test("no stored choice sets nothing, so the page still reads in dollars", () => {
    expect(harness({ stored: null }).root.dataset.unit).toBeUndefined();
  });

  test("a value nobody wrote is ignored rather than passed on to CSS", () => {
    expect(harness({ stored: "eur" }).root.dataset.unit).toBeUndefined();
    expect(harness({ stored: "usd" }).root.dataset.unit).toBeUndefined();
  });

  test("storage that throws leaves the page in dollars instead of breaking it", () => {
    const h = harness({ storageThrows: true });
    expect(h.root.dataset.unit).toBeUndefined();
    // And the rest of the script still ran: the buttons are wired.
    expect(() => h.ready()).not.toThrow();
    expect(() => h.click("tokens")).not.toThrow();
    expect(h.root.dataset.unit).toBe("tokens");
  });

  test("the marker moves to the stored choice once the buttons exist", () => {
    const h = harness({ stored: "tokens" });
    h.ready();
    expect(h.marked()).toEqual(["tokens"]);
  });

  test("with no stored choice the marker stays on $, where the server put it", () => {
    const h = harness({ stored: null });
    h.ready();
    expect(h.marked()).toEqual(["usd"]);
  });
});

describe("clicking a unit (criterion 5)", () => {
  test("it re-renders at once, remembers the choice, and moves the marker", () => {
    const h = harness({ stored: null });
    h.ready();
    h.click("tokens");
    expect(h.root.dataset.unit).toBe("tokens");
    expect(h.written).toEqual([["unit", "tokens"]]);
    expect(h.marked()).toEqual(["tokens"]);
  });

  test("choosing $ again puts the dollars back", () => {
    const h = harness({ stored: "tokens" });
    h.ready();
    h.click("usd");
    expect(h.root.dataset.unit).toBeUndefined();
    expect(h.written).toEqual([["unit", "usd"]]);
    expect(h.marked()).toEqual(["usd"]);
  });

  test("the unit is remembered under its own key, never the theme's", () => {
    const h = harness({ stored: null });
    h.ready();
    h.click("tokens");
    expect(h.written.map(([key]) => key)).toEqual(["unit"]);
  });
});
