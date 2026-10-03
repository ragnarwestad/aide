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

  test("a removal posts and reloads the page it is on, keeping the view", async () => {
    const h = harness(
      () => ({ ok: true, body: { ok: true, results: [{ step: "confirm", ok: true }] } }),
      "actionform",
      "?state=running&sort=cost",
      { pathname: "/projects" },
    );
    await h.submitRemove();
    const post = h.requests.find((r) => r.url.includes("/remove"))!;
    expect(post.init.method).toBe("POST");
    expect((post.init.headers as Record<string, string>).accept).toBe("application/json");
    // The panel is markup the server owns, and what changed is which
    // projects are in it — so the page is asked again, with the
    // reader's own query string. THIS page: no route name is written
    // down on either side of the move (spec 115).
    expect(h.location.href).toBe("/projects?state=running&sort=cost");
  });

  test("a removal tells the unsaved-changes guard the page's edits are left behind (AC-3)", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true, results: [] } }), "actionform", "?tab=config", {
      pathname: "/projects/atlasaurus",
    });
    await h.submitRemove();
    expect(h.dispatched).toContain("aide-changes-discarded");
    expect(h.location.href).toBe("/projects");
  });

  test("a refused removal leaves the guard armed (AC-3)", async () => {
    const h = harness(() => ({ ok: false, body: { ok: false, results: [{ step: "allowlist", error: "no" }] } }));
    await h.submitRemove();
    expect(h.dispatched).not.toContain("aide-changes-discarded");
  });

  test("the dialog stands while the removal is out, and stays standing as the page goes (AC-1, AC-4)", async () => {
    let standingWhileOut = false;
    const h = harness(
      (url) => {
        if (url.includes("/remove")) standingWhileOut = h.removeDialog.hasAttribute("data-standing");
        return { ok: true, body: { ok: true, results: [] } };
      },
      "actionform",
      "",
      { pathname: "/projects/atlasaurus" },
    );
    await h.submitRemove();
    expect(standingWhileOut).toBe(true);
    expect(h.removeDialog.open).toBe(true);
    expect(h.removeDialog.hasAttribute("data-standing")).toBe(true);
  });

  test("a refusal releases the dialog with its words in the dialog's own line (AC-3)", async () => {
    const h = harness(() => ({
      ok: false,
      body: { ok: false, results: [{ step: "allowlist", error: "not on the allowlist" }] },
    }));
    await h.submitRemove();
    expect(h.removeDialog.hasAttribute("data-standing")).toBe(false);
    expect(h.removeSlot.textContent).toContain("Not on the allowlist");
    expect(h.removeDialog.open).toBe(true);
  });

  test("a refusal is written in the dialog's own line, the dialog stays open and the page stays put (AC-3)", async () => {
    const h = harness(() => ({
      ok: false,
      body: { ok: false, results: [{ step: "allowlist", error: "not on the allowlist" }] },
    }));
    await h.submitRemove();
    expect(h.removeSlot.textContent).toContain("Not on the allowlist");
    expect(h.removeDialog.open).toBe(true);
    expect(h.removeDialog.closes).toBe(0);
    expect(h.location.href).toBe("http://dash.test/");
    expect(h.replaced).toHaveLength(0);
  });
});

// --- spec 115: the same code on a page with no spec list ---------------------
//
// The Add form shares the New-spec form's look (`pageform`), never its
// class: on `/projects` there is no New-spec form at all, and a form
// answering in its place would be bound twice, once as a project change
// and once as a spec create, sending two POSTs for one press.
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
      className: "pageform addprojectform",
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
// The Save form shares the look (`pageform`), exactly the way the Add
// form does, and on `/projects/<name>?edit=config` there is no New-spec
// form either — bound as one, its success would run `submitCreate`'s
// `location.href = "/"`. `submitProjectSettings` (forms.ts) is its
// own handler, bound to `form.projectsettingsform`: a successful save
// reloads the reader's own project path, dropping `?edit=config`; a refusal
// writes into the form's own `.refused` slot and leaves the page put.
describe("the project settings form's own Save (spec 486)", () => {
  /** Only the settings form on the page — there is no New-spec form and
   *  no Add/Remove form on `/projects/<name>` — so the binding count this
   *  proves is unambiguous: exactly one `submit` listener, and (via the
   *  reply passed in) exactly what it does with the answer. */
  const buildHarness = (reply: () => { ok: boolean; body?: unknown }) => {
    const refusedSlot = { textContent: "" };
    // The script's submit handler is async; awaiting it waits for its reply.
    const bound: [string, (e: Event) => void | Promise<void>][] = [];
    const form = {
      dataset: {} as Record<string, string>,
      className: "pageform projectsettingsform",
      action: "http://dash.test/api/queue/projects/aide/settings",
      fields: [] as [string, string][],
      closest: () => null,
      querySelector: (sel: string) => (sel === ".refused" ? refusedSlot : null),
      querySelectorAll: () => [],
      addEventListener: (type: string, fn: (e: Event) => void | Promise<void>) => void bound.push([type, fn]),
    };
    const document = {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (sel: string) => (sel.includes("projectsettingsform") ? [form] : []),
      addEventListener: () => {},
      visibilityState: "hidden",
    };
    const location = { search: "", href: "http://dash.test/projects/aide?edit=config", pathname: "/projects/aide" };
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

  test("a successful save reloads the reader's own project on Config, dropping ?edit=config", async () => {
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
    expect(h.location.href).toBe("http://dash.test/projects/aide?edit=config");
    expect(h.refusedSlot.textContent).toContain("Not a directory");
  });

  test("the settings form is bound exactly once, as its own handler", () => {
    const h = buildHarness(() => ({ ok: true, body: { ok: true, results: [] } }));
    expect(h.bound.map(([type]) => type)).toEqual(["submit"]);
  });
});
