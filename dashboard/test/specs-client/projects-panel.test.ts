import { describe, expect, test } from "bun:test";
import {
  SOURCE,
  harness,
} from "./fixtures.ts";
import { makeFakeFormData } from "./fixtures-runtime.ts";

// --- spec 112: the Projects panel --------------------------------------------

describe("Remove", () => {
  // The button was off until the project's name had been typed back
  // into a field. The page asks the question in a sentence instead
  // (2026-09-08), so the press is live from the moment it is drawn —
  // and nothing in the browser turns it off.
  test("the button is live from the moment the page loads", () => {
    const h = harness(() => ({ ok: true }));
    expect(h.removeButton.disabled).toBe(false);
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

});

// --- spec 486: the project settings form's own Save ---------------------------
//
// The Save form borrows `newspecform` for its look, exactly the way the
// Add form does, and on `/projects/<name>?edit=1` there is no New-spec
// form either — so before this fix `NEW_SPEC_FORM`'s selector picked the
// settings form up and bound it to `submitCreate`, whose success always
// runs `location.href = "/"`. `submitProjectSettings` (forms.ts) is its
// own handler, bound to `form.projectsettingsform`: a successful save
// reloads the reader's own project path, dropping `?edit=1`; a refusal
// writes into the form's own `.refused` slot and leaves the page put.
describe("the project settings form's own Save (spec 486)", () => {
  /** Only the settings form on the page — there is no New-spec form and
   *  no Add/Remove form on `/projects/<name>` — so the binding count this
   *  proves is unambiguous: exactly one `submit` listener, and (via the
   *  reply passed in) exactly what it does with the answer. */
  const buildHarness = (reply: () => { ok: boolean; body?: unknown }) => {
    const refusedSlot = { textContent: "" };
    const bound: [string, EventListener][] = [];
    const form = {
      dataset: {} as Record<string, string>,
      className: "newspecform projectsettingsform",
      action: "http://dash.test/api/queue/projects/aide/settings",
      fields: [] as [string, string][],
      closest: () => null,
      querySelector: (sel: string) => (sel === ".refused" ? refusedSlot : null),
      querySelectorAll: () => [],
      addEventListener: (type: string, fn: EventListener) => void bound.push([type, fn]),
    };
    const document = {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (sel: string) => (sel.includes("projectsettingsform") ? [form] : []),
      addEventListener: () => {},
      visibilityState: "hidden",
    };
    const location = { search: "", href: "http://dash.test/projects/aide?edit=1", pathname: "/projects/aide" };
    const fetchCalls: { url: string; init: Record<string, unknown> }[] = [];
    const fetchStub = async (url: unknown, init: Record<string, unknown> = {}) => {
      fetchCalls.push({ url: String(url), init });
      const r = reply();
      return { ok: r.ok, json: async () => r.body, text: async () => "" };
    };
    // eslint-disable-next-line no-new-func -- the file under test IS a script
    new Function(
      "document", "location", "fetch", "setInterval", "history", "FormData", "EventSource",
      SOURCE,
    )(
      document,
      location,
      fetchStub,
      () => 0,
      { replaceState: () => {} },
      makeFakeFormData(),
      class {
        addEventListener(): void {}
        close(): void {}
      },
    );
    const submit = bound.find(([type]) => type === "submit")?.[1];
    return { bound, form, location, refusedSlot, fetchCalls, submit };
  };

  test("a successful save reloads the reader's own project on Config, dropping ?edit=1", async () => {
    const h = buildHarness(() => ({ ok: true, body: { ok: true, results: [] } }));
    await h.submit!({ defaultPrevented: false, preventDefault: () => {} } as unknown as Event);
    expect(h.location.href).toBe("/projects/aide?tab=config");
  });

  test("a refusal is written into the form's own .refused slot, and the page stays put", async () => {
    const h = buildHarness(() => ({
      ok: false,
      body: { ok: false, results: [{ step: "specsPath", error: "not a directory" }] },
    }));
    await h.submit!({ defaultPrevented: false, preventDefault: () => {} } as unknown as Event);
    expect(h.location.href).toBe("http://dash.test/projects/aide?edit=1");
    expect(h.refusedSlot.textContent).toContain("not a directory");
  });

  test("the settings form is bound exactly once, as its own handler", () => {
    const h = buildHarness(() => ({ ok: true, body: { ok: true, results: [] } }));
    expect(h.bound.map(([type]) => type)).toEqual(["submit"]);
  });
});
