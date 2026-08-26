// Spec 243: `menu-script.ts` gives the "…" menu its close-on-outside-
// click-and-Escape behaviour (spec 119); the "?" run-info popup
// (`details.intro`) never got the same treatment because it predates
// the pattern. This file proves the broadened selector covers both
// without regressing the one that already worked.
//
// Same shape as `theme-script.test.ts`: transpile the file, run it via
// `new Function(...)` against a DOM small enough to state in full. The
// difference is that `closeAll()`'s `except` argument and `.closest()`
// both depend on parent/child structure, so the fake DOM here is a
// small element tree rather than a flat button list — with just enough
// of `matches`/`closest`/`querySelectorAll` to answer the selectors
// this script actually uses.
//
// `HTMLDialogElement` is passed in as a minimal stand-in class: the
// script's About-dialog branch runs `target instanceof HTMLDialogElement`
// on every click that is not a `[data-about]` click — every click this
// test simulates — and Bun's test runtime has no DOM global of that
// name (found in plan review: feasibility, must-fix).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
  readFileSync(join(import.meta.dir, "..", "src", "render", "scripts", "menu-script.ts"), "utf-8"),
);

class HTMLDialogElement {}

class Elem {
  tagName: string;
  className: string;
  attrs: Record<string, string>;
  open: boolean;
  children: Elem[] = [];
  parentElement: Elem | null = null;

  constructor(tag: string, opts: { className?: string; attrs?: Record<string, string>; open?: boolean } = {}) {
    this.tagName = tag.toUpperCase();
    this.className = opts.className ?? "";
    this.attrs = opts.attrs ?? {};
    this.open = opts.open ?? false;
  }

  append(child: Elem): Elem {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  private hasClass(c: string): boolean {
    return this.className.split(/\s+/).filter(Boolean).includes(c);
  }

  /** One simple selector: an optional tag, an optional `.class`, an
   *  optional `[attr]` — the only shapes `menu-script.ts` writes. */
  private matchesOne(selector: string): boolean {
    let s = selector.trim();
    const attrMatch = s.match(/\[([a-zA-Z-]+)\]/);
    const attr = attrMatch?.[1];
    if (attrMatch) s = s.replace(attrMatch[0], "");
    const classMatch = s.match(/\.([a-zA-Z-]+)/);
    const cls = classMatch?.[1];
    if (classMatch) s = s.replace(classMatch[0], "");
    const tag = s.trim();
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    if (cls && !this.hasClass(cls)) return false;
    if (attr) {
      if (attr === "open") {
        if (!this.open) return false;
      } else if (!(attr in this.attrs)) return false;
    }
    return true;
  }

  /** A comma-separated selector list, as every call site in
   *  `menu-script.ts` uses. */
  matches(selectorList: string): boolean {
    return selectorList.split(",").some((s) => this.matchesOne(s));
  }

  closest(selectorList: string): Elem | null {
    let el: Elem | null = this;
    while (el) {
      if (el.matches(selectorList)) return el;
      el = el.parentElement;
    }
    return null;
  }
}

/** A page with the "…" menu and the "?" popup, both closed, and one
 *  element outside either — everything `closeAll()` and its "except"
 *  lookup need to answer against. */
function harness() {
  const body = new Elem("body");
  const menuDetails = new Elem("details", { className: "menu" });
  const menuSummary = new Elem("summary");
  menuDetails.append(menuSummary);
  const menuPanel = new Elem("div", { className: "menupanel" });
  menuDetails.append(menuPanel);
  const aboutLink = new Elem("a", { attrs: { "data-about": "" } });
  menuPanel.append(aboutLink);

  const introDetails = new Elem("details", { className: "intro" });
  const introSummary = new Elem("summary");
  introDetails.append(introSummary);
  const introBody = new Elem("p");
  introDetails.append(introBody);

  const outside = new Elem("div");

  body.append(menuDetails);
  body.append(introDetails);
  body.append(outside);

  const listeners: Record<string, (e: unknown) => void> = {};
  const document = {
    addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] = fn),
    querySelectorAll: (sel: string): Elem[] => {
      const results: Elem[] = [];
      const walk = (el: Elem) => {
        if (el.matches(sel)) results.push(el);
        for (const c of el.children) walk(c);
      };
      walk(body);
      return results;
    },
    // Only reached by the About-dialog branch, which this file does not
    // exercise beyond "does not throw" — no `dialog.about` exists here.
    querySelector: (): null => null,
  };

  // eslint-disable-next-line no-new-func -- the file under test IS a script
  new Function("document", "HTMLDialogElement", SOURCE)(document, HTMLDialogElement);

  return {
    menuDetails,
    menuSummary,
    aboutLink,
    introDetails,
    introSummary,
    introBody,
    outside,
    click: (target: Elem) => listeners.click!({ target, preventDefault: () => {} }),
    escape: () => listeners.keydown!({ key: "Escape" }),
  };
}

describe("the '?' popup closes like the … menu now does (spec 243)", () => {
  test("an outside click closes it (criterion 1)", () => {
    const h = harness();
    h.introDetails.open = true;
    h.click(h.outside);
    expect(h.introDetails.open).toBe(false);
  });

  test("Escape closes it (criterion 2)", () => {
    const h = harness();
    h.introDetails.open = true;
    h.escape();
    expect(h.introDetails.open).toBe(false);
  });

  test("a click inside it leaves it open (criterion 3)", () => {
    const h = harness();
    h.introDetails.open = true;
    h.click(h.introBody);
    expect(h.introDetails.open).toBe(true);
  });

  test("a click on its own summary leaves it open too", () => {
    const h = harness();
    h.introDetails.open = true;
    h.click(h.introSummary);
    expect(h.introDetails.open).toBe(true);
  });
});

describe("the … menu's own behaviour is unchanged (criterion 4)", () => {
  test("an outside click still closes it", () => {
    const h = harness();
    h.menuDetails.open = true;
    h.click(h.outside);
    expect(h.menuDetails.open).toBe(false);
  });

  test("Escape still closes it", () => {
    const h = harness();
    h.menuDetails.open = true;
    h.escape();
    expect(h.menuDetails.open).toBe(false);
  });

  test("a click inside it still leaves it open", () => {
    const h = harness();
    h.menuDetails.open = true;
    h.click(h.menuSummary);
    expect(h.menuDetails.open).toBe(true);
  });
});

describe("the two disclosures do not interfere with each other", () => {
  test("both open, an outside click closes both", () => {
    const h = harness();
    h.menuDetails.open = true;
    h.introDetails.open = true;
    h.click(h.outside);
    expect(h.menuDetails.open).toBe(false);
    expect(h.introDetails.open).toBe(false);
  });

  test("both open, a click inside the popup closes the menu but not the popup", () => {
    const h = harness();
    h.menuDetails.open = true;
    h.introDetails.open = true;
    h.click(h.introBody);
    expect(h.menuDetails.open).toBe(false);
    expect(h.introDetails.open).toBe(true);
  });
});

describe("the About link still opens the dialog (unaffected by the broadened selector)", () => {
  test("clicking it closes both disclosures and does not throw", () => {
    const h = harness();
    h.menuDetails.open = true;
    expect(() => h.click(h.aboutLink)).not.toThrow();
    expect(h.menuDetails.open).toBe(false);
  });
});
