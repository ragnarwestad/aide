// A native "leave this page?" confirmation, armed the instant a field
// inside one of the seven surfaces' tracked forms changes, and
// disarmed the instant that form's own Save/Create is submitted or its
// Cancel is pressed.
//
// `unsaved-changes.ts` can neither import nor export anything, and its
// own listeners only ever call `.closest()` on the event target — no
// real bubbling or field snapshotting like spec-form-actions.ts needs —
// so, like nav-overlay.ts, it is transpiled and run here against a
// small hand-built fake document AND window (the latter for
// `beforeunload`, which lives on `window`, not `document`).

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const built = await Bun.build({
  entrypoints: [join(import.meta.dir, "..", "..", "..", "..", "src", "render", "ui", "forms", "unsaved-changes.ts")],
  target: "browser", format: "iife",
});
if (!built.success) throw new AggregateError(built.logs, "unsaved-changes.ts failed to bundle");
const SOURCE = await built.outputs[0]!.text();

type FakeElement = {
  closest: (sel: string) => FakeElement | null;
  hasAttribute?: (attr: string) => boolean;
};

/** An element whose `closest()` answers the way a real one would for
 *  the handful of selectors this script ever asks about: the five
 *  tracked form classes, the Units radio's own marker, and the two
 *  Cancel markers. Matched against the element's OWN properties only —
 *  every case this script cares about asks about the event target
 *  itself, never an ancestor several levels up. */
function element(opts: {
  classes?: string[]; id?: string; unitChoice?: boolean; discardChanges?: boolean;
  /** The tracked form this element sits in: asked about any selector the element itself does not match. */
  form?: FakeElement;
  /** `data-dirty-until-saved` on the element itself. */
  dirtyUntilSaved?: boolean;
} = {}): FakeElement {
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
    closest: (sel: string) => (sel.split(",").some(matchesOne) ? self : (opts.form?.closest(sel) ?? null)),
    hasAttribute: (attr: string) => attr === "data-dirty-until-saved" && !!opts.dirtyUntilSaved,
  };
  return self;
}

type FakeAnchor = FakeElement & {
  target: string;
  hasAttribute: (attr: string) => boolean;
  getAttribute: (attr: string) => string | null;
  click: () => void;
  /** How many times the script pressed the link itself. */
  clicks: number;
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
    click: () => {
      self.clicks += 1;
    },
    clicks: 0,
  };
  return self;
}

/** The leave dialog (`#leaveapp`), and what a test can ask and do to it. */
function fakeDialog() {
  let showModalCalled = false;
  let closeHandler: (() => void) | undefined;
  let dialogReturnValue = "";
  let dialogOpen = false;
  let showModalCalls = 0;
  const dialog = {
    showModal: () => {
      if (dialogOpen) throw new Error("showModal on an open dialog");
      showModalCalled = true;
      showModalCalls += 1;
      dialogOpen = true;
    },
    get open() {
      return dialogOpen;
    },
    addEventListener: (type: string, fn: () => void) => {
      if (type === "close") closeHandler = fn;
    },
    get returnValue() {
      return dialogReturnValue;
    },
    set returnValue(value: string) {
      dialogReturnValue = value;
    },
  };
  const controls = {
    wasOpened: () => showModalCalled,
    opened: () => showModalCalls,
    closeWith: (value: string) => {
      dialogReturnValue = value;
      dialogOpen = false;
      closeHandler?.();
    },
    /** Escape: the dialog closes and keeps whatever value it had. */
    escape: () => {
      dialogOpen = false;
      closeHandler?.();
    },
  };
  return { dialog, controls };
}

type Handler = (event: unknown) => void;

/** A click on `el`; true when the script prevented its default. */
function fireClick(
  handler: Handler,
  el: FakeElement,
  opts: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; button?: number } = {},
): boolean {
  let prevented = false;
  handler({
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
}

function fireBeforeunload(handler: Handler): { prevented: boolean; returnValue: unknown } {
  let prevented = false;
  let returnValue: unknown;
  handler({
    preventDefault: () => {
      prevented = true;
    },
    set returnValue(v: unknown) {
      returnValue = v;
    },
  });
  return { prevented, returnValue };
}

/** An in-place swap asking to leave, as page-swap sends it; what the
 *  guard did with it is kept on the returned record. */
function fireLeave(handler: Handler) {
  const seen = { prevented: false, asked: false, answer: "" };
  handler({
    preventDefault: () => {
      seen.prevented = true;
    },
    detail: {
      ask: () => { seen.asked = true; },
      proceed: () => { seen.answer ||= "proceed"; },
      stay: () => { seen.answer ||= "stay"; },
      drop: () => { seen.answer ||= "drop"; },
    },
  });
  return seen;
}

/** The script run against a fake document and window; the handlers it
 *  added are kept by event type. */
function harness() {
  const on: Record<string, Handler> = {};
  const { dialog, controls } = fakeDialog();
  const document = {
    addEventListener: (type: string, fn: Handler) => void (on[type] = fn),
    getElementById: (id: string) => (id === "leaveapp" ? dialog : null),
  };
  const window = {
    addEventListener: (type: string, fn: Handler) => {
      if (type === "beforeunload") on.beforeunload = fn;
    },
  };
  new Function("document", "window", SOURCE)(document, window);

  return {
    input: (el: FakeElement) => on.input!({ target: el }),
    change: (el: FakeElement) => on.change!({ target: el }),
    submit: (form: FakeElement) => on.submit!({ target: form }),
    /** The page script's word that a form's Save went through. */
    saved: (form: FakeElement) => on["aide-form-saved"]!({ target: form }),
    drawn: () => on["aide-page-drawn"]!({}),
    click: (el: FakeElement, opts?: Parameters<typeof fireClick>[2]) => fireClick(on.click!, el, opts),
    beforeunload: () => fireBeforeunload(on.beforeunload!),
    leave: () => fireLeave(on["aide-page-leave"]!),
    dialog: controls,
  };
}

describe("a page with an unsaved edit warns before it is left", () => {
  test("nothing edited: beforeunload does nothing", () => {
    const h = harness();
    const { prevented } = h.beforeunload();
    expect(prevented).toBe(false);
  });

  for (const cls of ["specform", "settingsform", "pageform", "scheduleform"]) {
    test(`an input inside .${cls} arms the guard`, () => {
      const h = harness();
      h.input(element({ classes: [cls] }));
      const { prevented, returnValue } = h.beforeunload();
      expect(prevented).toBe(true);
      // preventDefault() is the whole request; the deprecated returnValue stays untouched.
      expect(returnValue).toBeUndefined();
    });

    test(`a change inside .${cls} arms the guard`, () => {
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

  test("a pick on a field that posts to a form not on the page does not arm the guard", () => {
    const h = harness();
    // As a phase pick names the spec's run form: saved the moment it is
    // picked, so nothing this page would lose.
    h.change({ ...element({ classes: ["specform"] }), getAttribute: (a: string) => (a === "form" ? "rowrun-aide/1-x" : null) } as FakeElement);
    expect(h.beforeunload().prevented).toBe(false);
  });

  test("an input outside every tracked form does not arm the guard", () => {
    const h = harness();
    h.input(element({ classes: ["somethingelse"] }));
    const { prevented } = h.beforeunload();
    expect(prevented).toBe(false);
  });

  test("submitting the tracked form disarms an already-armed guard (Save/Create)", () => {
    const h = harness();
    const form = element({ classes: ["specform"] });
    h.input(form);
    h.submit(form);
    const { prevented } = h.beforeunload();
    expect(prevented).toBe(false);
  });

  test("clicking a [id$='-cancel'] control disarms it (six of the seven surfaces)", () => {
    const h = harness();
    h.input(element({ classes: ["specform"] }));
    h.click(element({ id: "specform-cancel" }));
    const { prevented } = h.beforeunload();
    expect(prevented).toBe(false);
  });

  test("clicking a [data-discard-changes] control disarms it (project settings' Cancel link)", () => {
    const h = harness();
    h.input(element({ classes: ["pageform"] }));
    h.click(element({ discardChanges: true }));
    const { prevented } = h.beforeunload();
    expect(prevented).toBe(false);
  });
});

// The native beforeunload prompt is drawn by the browser/OS
// and centers on the screen, not the app window — a limitation no page
// can work around. For the one exit path a page CAN intercept (an
// in-app link), a real <dialog> replaces it, which the browser always
// positions inside the document's own viewport. Back/
// Forward, a closed tab and a typed address still fall to the
// unchanged native prompt above.
describe("a same-document link click while dirty opens the leaveapp dialog instead of navigating", () => {
  test("dirty + a same-document link click: preventDefault and showModal both fire", () => {
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

  // The link is pressed again rather than its address assigned, so it
  // leaves as it always would: Back's `rel="noreferrer"` goes with it.
  test('pressing OK presses the link itself again and disarms the guard', () => {
    const h = harness();
    h.input(element({ classes: ["specform"] }));
    const link = anchor({ href: "/other-page" });
    h.click(link);
    h.dialog.closeWith("leave");
    expect(link.clicks).toBe(1);
    const { prevented } = h.beforeunload();
    expect(prevented).toBe(false);
  });

  test('pressing Cancel (or Escape) navigates nowhere and leaves the guard armed', () => {
    const h = harness();
    h.input(element({ classes: ["specform"] }));
    const link = anchor({ href: "/other-page" });
    h.click(link);
    h.dialog.closeWith("");
    expect(link.clicks).toBe(0);
    const { prevented } = h.beforeunload();
    expect(prevented).toBe(true);
  });
});

// Back/Forward through the in-place swap asks the same dialog. Whichever
// navigation opened it last owns the answer, whatever opened it first.
describe("the leaveapp dialog answers the navigation that opened it last", () => {
  test("a swap asking to leave a dirty page is refused, asked and left waiting for the answer (AC-1)", () => {
    const h = harness();
    h.input(element({ classes: ["settingsform"] }));
    const swap = h.leave();
    expect(swap).toEqual({ prevented: true, asked: true, answer: "" });
    expect(h.dialog.wasOpened()).toBe(true);
  });

  test("Cancel on a swap, then a link click: OK presses the link (AC-4)", () => {
    const h = harness();
    h.input(element({ classes: ["settingsform"] }));
    const swap = h.leave();
    h.dialog.closeWith("");
    expect(swap.answer).toBe("stay");
    const link = anchor({ href: "/other-page" });
    h.click(link);
    h.dialog.closeWith("leave");
    expect(link.clicks).toBe(1);
  });

  test("Cancel on a link click, then a swap: OK lets the swap go and leaves the link alone (AC-5)", () => {
    const h = harness();
    h.input(element({ classes: ["settingsform"] }));
    const link = anchor({ href: "/other-page" });
    h.click(link);
    h.dialog.closeWith("");
    const swap = h.leave();
    h.dialog.closeWith("leave");
    expect(swap.answer).toBe("proceed");
    expect(link.clicks).toBe(0);
  });

  test("a second swap while the dialog is open drops the first and takes the answer", () => {
    const h = harness();
    h.input(element({ classes: ["settingsform"] }));
    const first = h.leave();
    const second = h.leave();
    expect(first.answer).toBe("drop");
    expect(h.dialog.opened()).toBe(1);
    h.dialog.closeWith("leave");
    expect(second.answer).toBe("proceed");
    expect(first.answer).toBe("drop");
  });

  test("a link click while a swap holds the dialog drops the swap and takes the answer", () => {
    const h = harness();
    h.input(element({ classes: ["settingsform"] }));
    const swap = h.leave();
    const link = anchor({ href: "/other-page" });
    h.click(link);
    expect(swap.answer).toBe("drop");
    h.dialog.closeWith("leave");
    expect(link.clicks).toBe(1);
  });

  test("OK on a link click disarms the guard and presses that same link once (AC-7)", () => {
    const h = harness();
    h.input(element({ classes: ["settingsform"] }));
    const link = anchor({ href: "/other-page" });
    h.click(link);
    h.dialog.closeWith("leave");
    expect(link.clicks).toBe(1);
    expect(h.beforeunload().prevented).toBe(false);
    expect(h.leave()).toEqual({ prevented: false, asked: false, answer: "" });
  });

  test("Escape after an earlier OK keeps the page: the old OK does not answer the new dialog (AC-3)", () => {
    const h = harness();
    h.input(element({ classes: ["settingsform"] }));
    h.click(anchor({ href: "/other-page" }));
    h.dialog.closeWith("leave");
    h.input(element({ classes: ["settingsform"] }));
    const swap = h.leave();
    h.dialog.escape();
    expect(swap.answer).toBe("stay");
    const link = anchor({ href: "/other-page" });
    h.click(link);
    h.dialog.escape();
    expect(link.clicks).toBe(0);
    expect(h.beforeunload().prevented).toBe(true);
  });
});

// The Config tab holds two settings cards, each its own form, open at once.
// Each form is guarded on its own: what one card's Save or Cancel does
// says nothing about the other card's edits.
describe("two tracked forms on one page", () => {
  const card = () => element({ classes: ["pageform"], dirtyUntilSaved: true });
  const fieldIn = (form: FakeElement) => element({ form });

  test("(a) Cancel in one card leaves the other card's edits guarded (AC-9)", () => {
    const h = harness();
    const one = card();
    const two = card();
    h.input(fieldIn(one));
    h.input(fieldIn(two));
    h.click(element({ id: "projectsettingsform-config-cancel", form: one }));
    expect(h.beforeunload().prevented).toBe(true);
    h.click(element({ id: "projectsettingsform-manifest-cancel", form: two }));
    expect(h.beforeunload().prevented).toBe(false);
  });

  test("(b) a card's Save sent and refused still asks before leaving (AC-9)", () => {
    const h = harness();
    const one = card();
    h.input(fieldIn(one));
    h.submit(one);
    expect(h.beforeunload().prevented).toBe(true);
  });

  test("(c) one card saved while the other holds edits still asks before leaving (AC-9)", () => {
    const h = harness();
    const one = card();
    const two = card();
    h.input(fieldIn(one));
    h.input(fieldIn(two));
    h.submit(one);
    h.saved(one);
    expect(h.beforeunload().prevented).toBe(true);
  });

  test("(d) the only card with edits, saved, no longer asks (AC-9)", () => {
    const h = harness();
    const one = card();
    h.input(fieldIn(one));
    h.submit(one);
    h.saved(one);
    expect(h.beforeunload().prevented).toBe(false);
  });

  test("(e) an ordinary tracked form is still cleared by its own submit (AC-9)", () => {
    const h = harness();
    const form = element({ classes: ["settingsform"] });
    h.input(fieldIn(form));
    h.submit(form);
    expect(h.beforeunload().prevented).toBe(false);
  });

  test("a page drawn afresh clears every card", () => {
    const h = harness();
    h.input(fieldIn(card()));
    h.input(fieldIn(card()));
    h.drawn();
    expect(h.beforeunload().prevented).toBe(false);
  });
});
