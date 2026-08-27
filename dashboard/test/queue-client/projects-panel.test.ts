import { describe, expect, test } from "bun:test";
import {
  SOURCE,
  harness,
} from "./fixtures.ts";

// --- spec 112: the Projects panel --------------------------------------------

describe("Remove is gated on the name being typed back", () => {
  test("the button is off until the input matches, and on again when it does", () => {
    const h = harness(() => ({ ok: true }));
    // Off from the moment the page loads — the server renders it
    // enabled, because a button it disabled could never be enabled
    // again with script off.
    expect(h.removeButton.disabled).toBe(true);
    h.type("atlas");
    expect(h.removeButton.disabled).toBe(true);
    h.type("atlasaurus");
    expect(h.removeButton.disabled).toBe(false);
    // And off again the moment the reader edits it back out.
    h.type("atlasaurus ");
    expect(h.removeButton.disabled).toBe(true);
  });

  test("a removal posts the confirmation and reloads the page it is on, keeping the view", async () => {
    const h = harness(
      () => ({ ok: true, body: { ok: true, results: [{ step: "confirm", ok: true }] } }),
      "actionform",
      "?state=running&sort=cost",
      { pathname: "/projects" },
    );
    await h.submitRemove();
    const post = h.requests.find((r) => r.url.includes("/remove"))!;
    expect(post.init.method).toBe("POST");
    expect(String(post.init.body)).toContain("confirm=atlasaurus");
    expect((post.init.headers as Record<string, string>).accept).toBe("application/json");
    // The panel is markup the server owns, and what changed is which
    // projects are in it — so the page is asked again, with the
    // reader's own query string. THIS page: no route name is written
    // down on either side of the move (spec 115).
    expect(h.location.href).toBe("/projects?state=running&sort=cost");
  });

  test("a refusal is written beside the form, and the page stays put", async () => {
    const h = harness(() => ({
      ok: false,
      body: { ok: false, results: [{ step: "confirm", error: 'type the project name exactly' }] },
    }));
    await h.submitRemove();
    expect(h.removeSlot.textContent).toContain("type the project name exactly");
    expect(h.location.href).toBe("http://dash.test/");
    expect(h.replaced).toHaveLength(0);
  });
});

// --- spec 115: the same code on a page with no spec list ---------------------
//
// The Add form wears `newspecform` for its looks, and on `/` that was
// harmless: the real New-spec form came first in the document, so
// `querySelector` found it. On `/projects` there is no New-spec form at
// all — the Add form would answer in its place and be bound twice, once
// as a project change and once as a spec create, sending two POSTs for
// one press.
describe("on /projects, where there is no New-spec form", () => {
  /** Enough of a matcher for the two selectors the file uses: every
   *  `.class` in the compound has to be on the element, and none of the
   *  `:not(.class)` ones may be. */
  const matches = (selector: string, className: string): boolean => {
    const classes = className.split(/\s+/);
    const negated = [...selector.matchAll(/:not\(\.([\w-]+)\)/g)].map((m) => m[1]!);
    const required = [...selector.replace(/:not\([^)]*\)/g, "").matchAll(/\.([\w-]+)/g)].map((m) => m[1]!);
    return required.every((c) => classes.includes(c)) && !negated.some((c) => classes.includes(c));
  };

  test("the Add form is bound once — as a project change, not also as a create", () => {
    const bound: string[] = [];
    const addForm = {
      dataset: {} as Record<string, string>,
      className: "newspecform addprojectform",
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: (type: string) => void bound.push(type),
    };
    const document = {
      getElementById: () => null,
      querySelector: (sel: string) => (matches(sel, addForm.className) ? addForm : null),
      querySelectorAll: (sel: string) =>
        sel.includes("addprojectform") || sel.includes("removeform") ? [addForm] : [],
      createElement: () => ({ id: "", className: "", textContent: "" }),
      addEventListener: () => {},
      visibilityState: "hidden",
    };
    // eslint-disable-next-line no-new-func -- the file under test IS a script
    new Function(
      "document", "location", "fetch", "setInterval", "history", "FormData", "EventSource",
      SOURCE,
    )(
      document,
      { search: "", href: "http://dash.test/projects", pathname: "/projects" },
      async () => ({ ok: true, json: async () => ({}), text: async () => "" }),
      () => 0,
      { replaceState: () => {} },
      class {
        forEach(): void {}
      },
      class {
        addEventListener(): void {}
        close(): void {}
      },
    );
    expect(bound).toEqual(["submit"]);
  });

  // Spec 184: the server works out a proposal per offered checkout,
  // because nothing is picked at the moment the page is drawn. Picking
  // one fills the two fields in — and never overwrites an answer the
  // reader has typed, which would be help that undoes help.
  test("picking a checkout fills in that checkout's proposed settings", () => {
    const specs = { name: "specsPath", value: "", addEventListener: () => {} };
    const linksTyped: (() => void)[] = [];
    const links = {
      name: "worktreeLinks",
      value: "",
      addEventListener: (_t: string, fn: () => void) => void linksTyped.push(fn),
    };
    let onChange = (): void => {};
    const picker = {
      name: "existingPath",
      value: "",
      addEventListener: (type: string, fn: () => void) => {
        if (type === "change") onChange = fn;
      },
    };
    const addForm = {
      dataset: {
        proposals: JSON.stringify({
          skjer: { specsPath: "/repos/aide-specs/skjer", worktreeLinks: "node_modules" },
          bare: { specsPath: "", worktreeLinks: "" },
        }),
      } as Record<string, string>,
      className: "newspecform addprojectform",
      querySelector: (sel: string) =>
        sel.includes("existingPath") ? picker : sel.includes("specsPath") ? specs : sel.includes("worktreeLinks") ? links : null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    };
    const document = {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (sel: string) =>
        sel.includes("addprojectform") || sel.includes("removeform") ? [addForm] : [],
      createElement: () => ({ id: "", className: "", textContent: "" }),
      addEventListener: () => {},
      visibilityState: "hidden",
    };
    // eslint-disable-next-line no-new-func -- the file under test IS a script
    new Function("document", "location", "fetch", "setInterval", "history", "FormData", SOURCE)(
      document,
      { search: "", href: "http://dash.test/projects", pathname: "/projects" },
      async () => ({ ok: true, json: async () => ({}), text: async () => "" }),
      () => 0,
      { replaceState: () => {} },
      class {
        forEach(): void {}
      },
    );
    picker.value = "skjer";
    onChange();
    expect([specs.value, links.value]).toEqual(["/repos/aide-specs/skjer", "node_modules"]);

    // A checkout with nothing to propose clears the fields, so the form
    // never shows the previous pick's answer beside this one's name.
    picker.value = "bare";
    onChange();
    expect([specs.value, links.value]).toEqual(["", ""]);

    // And an answer the reader typed is theirs: the next pick fills the
    // other field and leaves this one exactly as they left it.
    links.value = "deps";
    for (const fn of linksTyped) fn();
    picker.value = "skjer";
    onChange();
    expect([specs.value, links.value]).toEqual(["/repos/aide-specs/skjer", "deps"]);
  });
});
