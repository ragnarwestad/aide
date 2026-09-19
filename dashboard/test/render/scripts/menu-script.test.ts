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
  readFileSync(join(import.meta.dir, "..", "..", "..", "src", "render", "scripts", "menu-script.ts"), "utf-8"),
);

class HTMLDialogElement {}

class Elem {
  tagName: string;
  className: string;
  attrs: Record<string, string>;
  open: boolean;
  value = "";
  children: Elem[] = [];
  parentElement: Elem | null = null;
  rect: { left: number; right: number; top: number; bottom: number } = { left: 0, right: 0, top: 0, bottom: 0 };
  style: { transform: string; removeProperty(prop: string): void } = {
    transform: "",
    removeProperty(prop: string) {
      if (prop === "transform") this.transform = "";
    },
  };
  private eventListeners: Record<string, ((e: unknown) => void)[]> = {};

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

  get classList() {
    return {
      add: (c: string) => {
        if (!this.hasClass(c)) this.className = `${this.className} ${c}`.trim();
      },
      remove: (c: string) => {
        this.className = this.className
          .split(/\s+/)
          .filter((x) => x && x !== c)
          .join(" ");
      },
      contains: (c: string) => this.hasClass(c),
    };
  }

  getBoundingClientRect() {
    return this.rect;
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.eventListeners[type] ??= []).push(fn);
  }

  dispatch(type: string): void {
    for (const fn of this.eventListeners[type] ?? []) fn({});
  }

  /** Depth-first, any depth: the phone menu's `.morerows` sits inside
   *  the panel, not directly under the menu. */
  find(selector: string): Elem | null {
    for (const c of this.children) {
      if (c.matches(selector)) return c;
      const deeper = c.find(selector);
      if (deeper) return deeper;
    }
    return null;
  }

  /** The one shape `menu-script.ts` queries with: `:scope > TAG`, a
   *  direct-child lookup — the only kind a real `querySelector` call
   *  in this file ever needs. */
  querySelector(selector: string): Elem | null {
    const m = selector.match(/^:scope\s*>\s*(.+)$/);
    const childSel = (m?.[1] ?? selector).trim();
    return this.children.find((c) => c.matches(childSel)) ?? null;
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
 *  lookup need to answer against. `innerWidth` stands in for the
 *  browser global `menu-script.ts`'s flip check reads. */
function harness(opts: { innerWidth?: number; storageThrows?: boolean; flag?: string } = {}) {
  const body = new Elem("body");
  const menuDetails = new Elem("details", { className: "menu" });
  const menuSummary = new Elem("summary");
  menuDetails.append(menuSummary);
  const menuPanel = new Elem("div", { className: "menupanel" });
  menuDetails.append(menuPanel);
  const aboutLink = new Elem("a", { attrs: { "data-about": "" } });
  menuPanel.append(aboutLink);
  const moreRows = new Elem("div", { className: "morerows lang" });
  menuPanel.append(moreRows);
  const langSelect = new Elem("select", { attrs: { "data-lang-select": "" } });
  moreRows.append(langSelect);
  const themeButton = new Elem("button", { attrs: { "data-theme-choice": "dark" } });
  moreRows.append(themeButton);

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
    // Also the reopen-after-language-change lookup for `.morerows`.
    querySelector: (sel: string): Elem | null => body.find(sel),
  };

  const window = { innerWidth: opts.innerWidth ?? 1024, location: { href: "/specs?lang=nb" } };

  const store: Record<string, string> = opts.flag ? { "menu-open": opts.flag } : {};
  const throwing = () => {
    throw new Error("storage is blocked");
  };
  const sessionStorage = opts.storageThrows
    ? { getItem: throwing, setItem: throwing, removeItem: throwing }
    : {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => void (store[k] = v),
        removeItem: (k: string) => void delete store[k],
      };

  // eslint-disable-next-line no-new-func -- the file under test IS a script
  new Function("document", "HTMLDialogElement", "window", "sessionStorage", SOURCE)(
    document,
    HTMLDialogElement,
    window,
    sessionStorage,
  );

  return {
    menuDetails,
    menuSummary,
    aboutLink,
    introDetails,
    introSummary,
    introBody,
    outside,
    window,
    store,
    langSelect,
    themeButton,
    change: (target: Elem) => listeners.change?.({ target }),
    load: () => listeners.DOMContentLoaded?.({}),
    click: (target: Elem) => listeners.click!({ target, preventDefault: () => {} }),
    escape: () => listeners.keydown!({ key: "Escape" }),
    /** Sets the popup's own position, opens or closes it, and fires the
     *  `toggle` event `menu-script.ts` listens for on `document` (spec
     *  477's delegated listener, not one attached to the element itself)
     *  — the same sequence a real `<details>` produces when its `open`
     *  property changes. */
    toggleIntro: (open: boolean, rect?: Partial<typeof introBody.rect>) => {
      introDetails.open = open;
      if (rect) Object.assign(introBody.rect, rect);
      listeners.toggle!({ target: introDetails });
    },
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

// Spec 477: a "(?)" popover's own CSS default sends it to one side of
// its icon, with no idea whether that side has room at the current
// window width. `menu-script.ts` measures the opened popover on every
// `toggle` and flips it to the other side when the default would run
// past the left or right edge of the viewport.
describe("a '?' popup flips side when its default position would run off screen (spec 477)", () => {
  test("overflowing the left edge flips it to intro-flip", () => {
    const h = harness({ innerWidth: 1024 });
    h.toggleIntro(true, { left: -10, right: 200, top: 0, bottom: 50 });
    expect(h.introDetails.classList.contains("intro-flip")).toBe(true);
  });

  test("overflowing the right edge flips it to intro-flip (the .acceptance-col case)", () => {
    const h = harness({ innerWidth: 1024 });
    h.toggleIntro(true, { left: 900, right: 1100, top: 0, bottom: 50 });
    expect(h.introDetails.classList.contains("intro-flip")).toBe(true);
  });

  test("room to spare on both edges stays put", () => {
    const h = harness({ innerWidth: 1024 });
    h.toggleIntro(true, { left: 100, right: 300, top: 0, bottom: 50 });
    expect(h.introDetails.classList.contains("intro-flip")).toBe(false);
  });

  test("closing then reopening in a fitting position clears a stale flip", () => {
    const h = harness({ innerWidth: 1024 });
    h.toggleIntro(true, { left: -10, right: 200, top: 0, bottom: 50 });
    expect(h.introDetails.classList.contains("intro-flip")).toBe(true);
    h.toggleIntro(false);
    h.toggleIntro(true, { left: 100, right: 300, top: 0, bottom: 50 });
    expect(h.introDetails.classList.contains("intro-flip")).toBe(false);
  });
});

// Spec 477 Round 4: a flip picks the side with more room, but an icon
// near the MIDDLE of a narrow window (the "Depends on" field's own
// popover, wrapped there at 760px — 2-analysis.md) can still overflow
// on its flipped side too, when the popover is wider than the room on
// EITHER side. A binary flip cannot fix that; only shifting the
// popover the rest of the way by the exact overflow can.
describe("a '?' popup that overflows on its flipped side too is shifted the rest of the way (spec 477 round 4)", () => {
  test("still overflowing the right edge after flipping is shifted left by the exact overflow", () => {
    const h = harness({ innerWidth: 1024 });
    h.toggleIntro(true, { left: 600, right: 1200, top: 0, bottom: 50 });
    expect(h.introDetails.classList.contains("intro-flip")).toBe(true);
    expect(h.introBody.style.transform).toBe("translateX(-176px)");
  });

  test("a popover wider than the window itself is pinned to the left edge", () => {
    const h = harness({ innerWidth: 1024 });
    h.toggleIntro(true, { left: -300, right: 1300, top: 0, bottom: 50 });
    expect(h.introBody.style.transform).toBe("translateX(300px)");
  });

  test("a fitting position clears a stale shift", () => {
    const h = harness({ innerWidth: 1024 });
    h.toggleIntro(true, { left: 600, right: 1200, top: 0, bottom: 50 });
    expect(h.introBody.style.transform).toBe("translateX(-176px)");
    h.toggleIntro(false);
    h.toggleIntro(true, { left: 100, right: 300, top: 0, bottom: 50 });
    expect(h.introBody.style.transform).toBe("");
  });
});

// Spec 507: the phone menu's language is a dropdown, and a dropdown
// does not navigate on its own the way the header's links do.
describe("the phone menu's language dropdown (spec 507)", () => {
  test("a change on it sends the page to the chosen address (AC-3)", () => {
    const h = harness();
    h.langSelect.value = "/specs?lang=de";
    h.change(h.langSelect);
    expect(h.window.location.href).toBe("/specs?lang=de");
  });

  test("a change from any other element does nothing (AC-3)", () => {
    const h = harness();
    h.themeButton.value = "/specs?lang=de";
    h.change(h.themeButton);
    expect(h.window.location.href).toBe("/specs?lang=nb");
    expect(h.store["menu-open"]).toBeUndefined();
  });

  test("a click on a theme button or the select inside the open menu leaves it open (AC-6)", () => {
    const h = harness();
    h.menuDetails.open = true;
    h.click(h.themeButton);
    expect(h.menuDetails.open).toBe(true);
    h.click(h.langSelect);
    expect(h.menuDetails.open).toBe(true);
    h.click(h.outside);
    expect(h.menuDetails.open).toBe(false);
  });

  test("a language change leaves a flag before the page moves (AC-6)", () => {
    const h = harness();
    h.langSelect.value = "/specs?lang=de";
    h.change(h.langSelect);
    expect(h.store["menu-open"]).toBe("1");
  });

  test("a load with the flag opens the menu and clears the flag (AC-6)", () => {
    const h = harness({ flag: "1" });
    h.load();
    expect(h.menuDetails.open).toBe(true);
    expect(h.store["menu-open"]).toBeUndefined();
  });

  test("a load without the flag leaves the menu closed (AC-6)", () => {
    const h = harness();
    h.load();
    expect(h.menuDetails.open).toBe(false);
  });

  test("storage that throws stops nothing: the page still moves (AC-6)", () => {
    const h = harness({ storageThrows: true });
    h.langSelect.value = "/specs?lang=de";
    expect(() => h.change(h.langSelect)).not.toThrow();
    expect(h.window.location.href).toBe("/specs?lang=de");
    expect(() => h.load()).not.toThrow();
    expect(h.menuDetails.open).toBe(false);
  });
});
