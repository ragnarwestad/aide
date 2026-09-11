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

function harness() {
  let inputHandler: ((event: unknown) => void) | undefined;
  let changeHandler: ((event: unknown) => void) | undefined;
  let submitHandler: ((event: unknown) => void) | undefined;
  let clickHandler: ((event: unknown) => void) | undefined;
  let beforeunloadHandler: ((event: unknown) => void) | undefined;

  const document = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (type === "input") inputHandler = fn;
      else if (type === "change") changeHandler = fn;
      else if (type === "submit") submitHandler = fn;
      else if (type === "click") clickHandler = fn;
    },
  };
  const window = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (type === "beforeunload") beforeunloadHandler = fn;
    },
  };
  new Function("document", "window", SOURCE)(document, window);

  const input = (el: FakeElement) => inputHandler!({ target: el });
  const change = (el: FakeElement) => changeHandler!({ target: el });
  const submit = (form: FakeElement) => submitHandler!({ target: form });
  const click = (el: FakeElement) => clickHandler!({ target: el });
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

  return { input, change, submit, click, beforeunload };
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
      expect(returnValue).toBe("");
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
