// A native "leave this page?" confirmation, armed the instant a field
// inside one of the seven AC-2 surfaces' tracked forms changes, and
// disarmed the instant that form's own Save/Create is submitted or its
// Cancel is pressed (spec 438).
//
// `unsaved-changes.ts` can neither import nor export anything, and its
// own listeners only ever call `.closest()` on the event target — no
// real bubbling or field snapshotting like spec-form-actions.ts needs —
// so, like nav-overlay.ts, it is transpiled and run here against a
// small hand-built fake document AND window (the latter for
// `beforeunload`, which lives on `window`, not `document`).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
  readFileSync(join(import.meta.dir, "..", "..", "..", "..", "src", "render", "ui", "forms", "unsaved-changes.ts"), "utf-8"),
);

type FakeElement = {
  closest: (sel: string) => FakeElement | null;
};

/** An element whose `closest()` answers the way a real one would for
 *  the handful of selectors this script ever asks about: the five
 *  tracked form classes, the Units radio's own marker, and the two
 *  Cancel markers. Matched against the element's OWN properties only —
 *  every case this script cares about asks about the event target
 *  itself, never an ancestor several levels up. */
function element(opts: { classes?: string[]; id?: string; unitChoice?: boolean; discardChanges?: boolean } = {}): FakeElement {
  const classes = opts.classes ?? [];
  const matchesOne = (sel: string): boolean => {
    const s = sel.trim();
    if (s.startsWith(".")) return classes.includes(s.slice(1));
    if (s === "[data-unit-choice]") return !!opts.unitChoice;
    if (s === "[data-discard-changes]") return !!opts.discardChanges;
    if (s === "[id$='-cancel']") return !!opts.id?.endsWith("-cancel");
    return false;
  };
  const self: FakeElement = {
    closest: (sel: string) => (sel.split(",").some(matchesOne) ? self : null),
  };
  return self;
}

type FakeAnchor = FakeElement & {
  target: string;
  hasAttribute: (attr: string) => boolean;
  getAttribute: (attr: string) => string | null;
};

/** A same-document `<a href>`, matched by `closest("a[href]")` the way a
 *  click landing directly on the link itself would be — every case this
 *  script cares about reads the anchor's own `target`/`download`/`href`,
 *  never an ancestor's. */
function anchor(opts: { href?: string; blank?: boolean; download?: boolean } = {}): FakeAnchor {
  const href = opts.href ?? "/other-page";
  const self: FakeAnchor = {
    closest: (sel: string) => (sel === "a[href]" ? self : null),
    target: opts.blank ? "_blank" : "",
    hasAttribute: (attr: string) => attr === "download" && !!opts.download,
    getAttribute: (attr: string) => (attr === "href" ? href : null),
  };
  return self;
}

function harness() {
  let inputHandler: ((event: unknown) => void) | undefined;
  let changeHandler: ((event: unknown) => void) | undefined;
  let submitHandler: ((event: unknown) => void) | undefined;
  let clickHandler: ((event: unknown) => void) | undefined;
  let beforeunloadHandler: ((event: unknown) => void) | undefined;

  let showModalCalled = false;
  let closeHandler: (() => void) | undefined;
  let dialogReturnValue = "";
  const dialog = {
    showModal: () => {
      showModalCalled = true;
    },
    addEventListener: (type: string, fn: () => void) => {
      if (type === "close") closeHandler = fn;
    },
    get returnValue() {
      return dialogReturnValue;
    },
  };

  let locationHref = "";

  const document = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (type === "input") inputHandler = fn;
      else if (type === "change") changeHandler = fn;
      else if (type === "submit") submitHandler = fn;
      else if (type === "click") clickHandler = fn;
    },
    querySelector: (sel: string) => (sel === "dialog.leaveapp" ? dialog : null),
  };
  const window = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (type === "beforeunload") beforeunloadHandler = fn;
    },
    location: {
      set href(v: string) {
        locationHref = v;
      },
      get href() {
        return locationHref;
      },
    },
  };
  new Function("document", "window", SOURCE)(document, window);

  const input = (el: FakeElement) => inputHandler!({ target: el });
  const change = (el: FakeElement) => changeHandler!({ target: el });
  const submit = (form: FakeElement) => submitHandler!({ target: form });
  const click = (
    el: FakeElement,
    opts: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; button?: number } = {},
  ): boolean => {
    let prevented = false;
    clickHandler!({
      target: el,
      get defaultPrevented() {
        return prevented;
      },
      preventDefault: () => {
        prevented = true;
      },
      metaKey: opts.metaKey ?? false,
      ctrlKey: opts.ctrlKey ?? false,
      shiftKey: opts.shiftKey ?? false,
      button: opts.button ?? 0,
    });
    return prevented;
  };
  const beforeunload = (): { prevented: boolean; returnValue: unknown } => {
    let prevented = false;
    let returnValue: unknown;
    beforeunloadHandler!({
      preventDefault: () => {
        prevented = true;
      },
      set returnValue(v: unknown) {
        returnValue = v;
      },
    });
    return { prevented, returnValue };
  };

  return {
    input,
    change,
    submit,
    click,
    beforeunload,
    dialog: {
      wasOpened: () => showModalCalled,
      closeWith: (value: string) => {
        dialogReturnValue = value;
        closeHandler?.();
      },
    },
    locationHref: () => locationHref,
  };
}

describe("a page with an unsaved edit warns before it is left (spec 438)", () => {
  test("nothing edited: beforeunload does nothing (AC-4)", () => {
    const h = harness();
    const { prevented } = h.beforeunload();
    expect(prevented).toBe(false);
  });

  for (const cls of ["specform", "trackingform", "settingsform", "newspecform", "scheduleform"]) {
    test(`an input inside .${cls} arms the guard (AC-1/AC-2)`, () => {
      const h = harness();
      h.input(element({ classes: [cls] }));
      const { prevented, returnValue } = h.beforeunload();
      expect(prevented).toBe(true);
      // preventDefault() is the whole request; the deprecated returnValue stays untouched.
      expect(returnValue).toBeUndefined();
    });

    test(`a change inside .${cls} arms the guard (AC-1/AC-2)`, () => {
      const h = harness();
      h.change(element({ classes: [cls] }));
      const { prevented } = h.beforeunload();
      expect(prevented).toBe(true);
    });
  }

  test("a change on the page-wide Units radio does not arm the guard", () => {
    const h = harness();
    h.change(element({ classes: ["specform"], unitChoice: true }));
    const { prevented } = h.beforeunload();
    expect(prevented).toBe(false);
  });

  test("an input outside every tracked form does not arm the guard", () => {
    const h = harness();
    h.input(element({ classes: ["somethingelse"] }));
    const { prevented } = h.beforeunload();
    expect(prevented).toBe(false);
  });

  test("submitting the tracked form disarms an already-armed guard (AC-5, Save/Create)", () => {
    const h = harness();
    h.input(element({ classes: ["specform"] }));
    h.submit(element({ classes: ["specform"] }));
    const { prevented } = h.beforeunload();
    expect(prevented).toBe(false);
  });

  test("clicking a [id$='-cancel'] control disarms it (AC-5, six of the seven surfaces)", () => {
    const h = harness();
    h.input(element({ classes: ["specform"] }));
    h.click(element({ id: "specform-cancel" }));
    const { prevented } = h.beforeunload();
    expect(prevented).toBe(false);
  });

  test("clicking a [data-discard-changes] control disarms it (AC-5, project settings' Cancel link)", () => {
    const h = harness();
    h.input(element({ classes: ["newspecform"] }));
    h.click(element({ discardChanges: true }));
    const { prevented } = h.beforeunload();
    expect(prevented).toBe(false);
  });
});

// Spec 478: the native beforeunload prompt is drawn by the browser/OS
// and centers on the screen, not the app window — a limitation no page
// can work around. For the one exit path a page CAN intercept (an
// in-app link), a real <dialog> replaces it, which the browser always
// positions inside the document's own viewport (AC-1/AC-2). Back/
// Forward, a closed tab and a typed address still fall to the
// unchanged native prompt above.
describe("a same-document link click while dirty opens dialog.leaveapp instead of navigating (spec 478)", () => {
  test("dirty + a same-document link click: preventDefault and showModal both fire (AC-1/AC-2)", () => {
    const h = harness();
    h.input(element({ classes: ["specform"] }));
    const prevented = h.click(anchor({ href: "/other-page" }));
    expect(prevented).toBe(true);
    expect(h.dialog.wasOpened()).toBe(true);
  });

  test("not dirty: the same link click does nothing", () => {
    const h = harness();
    const prevented = h.click(anchor({ href: "/other-page" }));
    expect(prevented).toBe(false);
    expect(h.dialog.wasOpened()).toBe(false);
  });

  test("dirty + a modified click (e.g. Ctrl+click to open a new tab) is left alone", () => {
    const h = harness();
    h.input(element({ classes: ["specform"] }));
    const prevented = h.click(anchor({ href: "/other-page" }), { ctrlKey: true });
    expect(prevented).toBe(false);
    expect(h.dialog.wasOpened()).toBe(false);
  });

  for (const [label, opts] of [
    ["target=\"_blank\"", { href: "/x", blank: true }],
    ["download", { href: "/x", download: true }],
    ["a #-fragment", { href: "#top" }],
    ["a mailto: link", { href: "mailto:a@b.com" }],
    ["a tel: link", { href: "tel:12345" }],
  ] as const) {
    test(`dirty + a ${label} link: left to the browser's own handling, not intercepted`, () => {
      const h = harness();
      h.input(element({ classes: ["specform"] }));
      const prevented = h.click(anchor(opts));
      expect(prevented).toBe(false);
      expect(h.dialog.wasOpened()).toBe(false);
    });
  }

  test('pressing "Leave" navigates to the link\'s href and disarms the guard', () => {
    const h = harness();
    h.input(element({ classes: ["specform"] }));
    h.click(anchor({ href: "/other-page" }));
    h.dialog.closeWith("leave");
    expect(h.locationHref()).toBe("/other-page");
    const { prevented } = h.beforeunload();
    expect(prevented).toBe(false);
  });

  test('pressing "Stay" (or Escape) navigates nowhere and leaves the guard armed', () => {
    const h = harness();
    h.input(element({ classes: ["specform"] }));
    h.click(anchor({ href: "/other-page" }));
    h.dialog.closeWith("");
    expect(h.locationHref()).toBe("");
    const { prevented } = h.beforeunload();
    expect(prevented).toBe(true);
  });
});
