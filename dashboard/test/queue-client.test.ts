// Spec 96: the page's own merge submit. Pressing Merge used to be a
// plain form POST — several seconds with nothing changing on the button,
// then a 303 back to the list and a reload that threw the reader to the
// top of the page.
//
// Spec 101 gave the same treatment to the other four controls (Run,
// Approve, Cancel, Create) and took the last navigation out of the
// refusal path, so this file now covers one shared handler rather than
// Merge's own special case.
//
// `queue-client.ts` can neither import nor export anything (the server
// transpiles it into an inline classic <script>), so it cannot be
// imported by a test the way every other module here is. It CAN be
// transpiled and run — which is what this file does, against a document
// small enough to state in full: getElementById, one delegated listener,
// one form, one button. What that proves is the DECISION — what is
// requested, when the button changes, and when the page is allowed to
// navigate — which is the whole of what this file decides.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
  readFileSync(join(import.meta.dir, "..", "src", "queue-client.ts"), "utf-8"),
);

interface Reply {
  ok: boolean;
  body?: unknown;
  throws?: boolean;
  /** Hold the request open until this settles — for what happens
   *  WHILE a press is in flight. */
  hold?: Promise<void>;
}

/** What each control is called before and during its request. The
 *  wording is the server's (`data-pending` in the markup); the harness
 *  only has to carry it the way the DOM would. */
const CONTROLS: Record<string, { label: string; pending: string; action: string }> = {
  mergeform: { label: "Merge the code", pending: "merging…", action: "http://dash.test/api/queue/job-1/merge" },
  rowrun: { label: "Run", pending: "starting…", action: "http://dash.test/api/queue" },
  actionform: { label: "Approve", pending: "approving…", action: "http://dash.test/api/queue/job-1/approve" },
};

/** One button in one form in `#jobrows`, the New-spec form beside it,
 *  and the globals the file actually touches. Nothing here pretends to
 *  be a browser: it answers the handful of questions the code asks, and
 *  records what it was asked to do. */
function harness(reply: (url: string) => Reply, formClass = "mergeform", search = "") {
  const control = CONTROLS[formClass]!;
  const button = {
    textContent: control.label,
    disabled: false,
    isConnected: true,
    dataset: { pending: control.pending },
  };
  const tokenInput = { value: "s3cret" };
  const form = {
    action: control.action,
    className: formClass,
    fields: [["steps", "analyze"], ["view.state", "active"]] as [string, string][],
    querySelectorAll: () => [button],
    querySelector: (sel: string) => (sel.includes("token") ? tokenInput : null),
    closest: (sel: string) => (sel.includes(`.${formClass}`) ? form : null),
  };

  // The New-spec form lives OUTSIDE #jobrows on purpose (a half-typed
  // description must survive the five-second swap), so it is bound
  // directly rather than by delegation — a second code path, tested as
  // one.
  const createButton = {
    textContent: "Create",
    disabled: false,
    isConnected: true,
    dataset: { pending: "creating…" },
  };
  const slot = { textContent: "" };
  const details = { open: true };
  const resets: number[] = [];
  const createForm = {
    action: "http://dash.test/api/queue/create",
    fields: [["project", "aide"], ["title", "A spec"]] as [string, string][],
    querySelectorAll: () => [createButton],
    querySelector: (sel: string) => (sel.includes("token") ? tokenInput : sel.includes("refused") ? slot : null),
    closest: (sel: string) => (sel.includes("details") ? details : null),
    reset: () => void resets.push(1),
    addEventListener: (type: string, fn: (e: unknown) => void) => void (on[`create:${type}`] = fn),
  };

  const inserted: { id: string; className: string; textContent: string }[] = [];
  const parentNode = {
    insertBefore: (node: { id: string; className: string; textContent: string }) => void inserted.push(node),
  };
  const rows = {
    innerHTML: "",
    parentNode,
    addEventListener: (type: string, fn: (e: unknown) => void) => void (on[type] = fn),
  };
  const on: Record<string, (e: unknown) => void> = {};
  const requests: { url: string; init: Record<string, unknown> }[] = [];
  const location = { search, href: "http://dash.test/" };
  // `replaceState` moves the address bar WITHOUT loading a document, so
  // it writes `search` (which `swapRows` reads back) and deliberately
  // leaves `href` alone: in this file `href` means "the page navigated",
  // and that is the thing the refusal path stopped doing.
  const replaced: string[] = [];
  const history = {
    replaceState: (_state: unknown, _title: string, url: string) => {
      replaced.push(String(url));
      location.search = new URL(String(url), "http://dash.test").search;
    },
  };

  const document = {
    getElementById: (id: string) => (id === "jobrows" ? rows : null),
    querySelector: (sel: string) => (sel.includes("newspecform") ? createForm : null),
    createElement: () => ({ id: "", className: "", textContent: "" }),
    addEventListener: () => {},
    visibilityState: "hidden",
  };
  const fetchStub = async (url: unknown, init: Record<string, unknown> = {}) => {
    const at = String(url);
    requests.push({ url: at, init });
    const r = reply(at);
    if (r.throws) throw new Error("offline");
    if (r.hold) await r.hold;
    return {
      ok: r.ok,
      json: async () => r.body,
      text: async () => "<tr></tr>",
    };
  };
  // The form serializer the browser owns. Injected rather than reached
  // for as a global, because a fake form is not an HTMLFormElement and
  // the real constructor refuses it.
  class FakeFormData {
    constructor(private readonly f: { fields?: [string, string][] }) {}
    forEach(fn: (value: string, key: string) => void): void {
      for (const [k, v] of this.f.fields ?? []) fn(v, k);
    }
  }

  // eslint-disable-next-line no-new-func -- the file under test IS a script
  let tick: () => void = () => {};
  new Function("document", "location", "fetch", "setInterval", "history", "FormData", SOURCE)(
    document,
    location,
    fetchStub,
    (fn: () => void) => {
      tick = fn;
      return 0;
    },
    history,
    FakeFormData,
  );

  const fire = (
    listener: string,
    target: unknown,
    extra: Partial<{ defaultPrevented: boolean }> = {},
  ) => {
    let prevented = extra.defaultPrevented ?? false;
    const event = {
      target,
      get defaultPrevented() {
        return prevented;
      },
      preventDefault: () => {
        prevented = true;
      },
    };
    return on[listener]!(event) as unknown as Promise<void>;
  };

  const submit = (extra: Partial<{ defaultPrevented: boolean }> = {}) => {
    // The button is what a click lands on; `closest` walks up to the form.
    (button as unknown as { closest: (s: string) => unknown }).closest = form.closest;
    return fire("submit", button, extra);
  };
  const submitCreate = (extra: Partial<{ defaultPrevented: boolean }> = {}) =>
    fire("create:submit", createButton, extra);

  return {
    submit, submitCreate, button, createButton, requests, location, rows, inserted,
    replaced, slot, details, resets, document, tick: () => tick(),
  };
}

const OK_MERGE = { ok: true, results: [{ root: "/repos/aide", ok: true }] };
/** Where `swapRows` asked for the rows, which is where the refusal the
 *  page is about to show comes from. */
const swapUrl = (h: { requests: { url: string }[] }): string =>
  h.requests.map((r) => r.url).find((u) => u.startsWith("/?") && u.includes("rows=1")) ?? "";

describe("the merge button posts from the page (criteria 10-12)", () => {
  test("it asks for JSON on the form's own route, and carries the token", async () => {
    const h = harness((url) => (url.includes("/merge") ? { ok: true, body: OK_MERGE } : { ok: true }));
    await h.submit();
    const merge = h.requests.find((r) => r.url.includes("/merge"))!;
    expect(merge.init.method).toBe("POST");
    expect((merge.init.headers as Record<string, string>).accept).toBe("application/json");
    // The guard reads a header, the query string or the cookie — never
    // the form body, which is where the hidden field would have gone.
    expect(merge.url).toContain("token=s3cret");
  });

  test("the button says so at once, instead of looking untouched (criterion 10)", async () => {
    let seen = "";
    const h = harness((url) => {
      if (url.includes("/merge")) seen = h.button.textContent;
      return { ok: true, body: OK_MERGE };
    });
    await h.submit();
    expect(seen).toBe("merging…");
    // And the page stayed where the reader was.
    expect(h.location.href).toBe("http://dash.test/");
  });

  test("the rows are swapped as soon as the answer arrives, not on the next tick (criterion 11)", async () => {
    const h = harness(() => ({ ok: true, body: OK_MERGE }));
    await h.submit();
    expect(swapUrl(h)).toContain("rows=1");
    expect(h.rows.innerHTML).toBe("<tr></tr>");
  });

  // The five-second tick swaps `#jobrows` from the server. While a press
  // is in flight the server still shows the OLD state, so a swap in that
  // window put back an untouched "Merge the plan" over the "merging…"
  // the press had just shown — seen on 2026-08-19: no feedback, then a
  // jump. The tick waits while anything is in flight.
  test("the tick does not swap the rows while a press is in flight", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const h = harness((url) => (url.includes("/merge") ? { ok: true, body: OK_MERGE, hold: held } : { ok: true }));
    h.document.visibilityState = "visible";
    const pressed = h.submit();
    await Promise.resolve();
    h.tick();
    await Promise.resolve();
    expect(h.requests.filter((r) => r.url.includes("rows=1"))).toHaveLength(0);
    expect(h.button.textContent).toBe("merging…");
    release();
    await pressed;
    // Once the answer is in, the rows are fetched (criterion 11) — once.
    expect(h.requests.filter((r) => r.url.includes("rows=1"))).toHaveLength(1);
    h.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.requests.filter((r) => r.url.includes("rows=1"))).toHaveLength(2);
  });

  test("a merge that cannot be sent at all reloads rather than lying (criterion 12)", async () => {
    const h = harness(() => ({ ok: false, throws: true }));
    await h.submit();
    expect(h.location.href).toBe("/");
  });

  // Merged is not deployed: the code reaching the default branch changes
  // nothing on the machine until the project's install runs, and spec
  // 92's merged code went on running as the old version because nobody
  // was told.
  test("what the install did is said on the page, not only in the JSON", async () => {
    const h = harness(() => ({
      ok: true,
      body: {
        ok: true,
        results: [{ root: "/repos/aide", ok: true, installError: "merged, not installed — deploying is a hand step" }],
      },
    }));
    await h.submit();
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]!.textContent).toContain("not installed");
    // The banner the page already has for a refusal, and still no jump.
    // `refusal` is the selector hook; `rowmsg err` is the component
    // that gives it the look every other refusal on the page has.
    expect(h.inserted[0]!.className).toBe("refusal rowmsg err");
    expect(h.location.href).toBe("http://dash.test/");
  });

  test("an install that said nothing leaves no banner behind", async () => {
    const h = harness(() => ({ ok: true, body: OK_MERGE }));
    await h.submit();
    expect(h.inserted).toHaveLength(0);
  });

  // A form whose own onsubmit cancelled the event is not ours to post:
  // a delegated handler that ignored that would post anyway.
  test("a submit that was already cancelled posts nothing", async () => {
    const h = harness(() => ({ ok: true, body: OK_MERGE }), "mergeform");
    await h.submit({ defaultPrevented: true });
    expect(h.requests).toHaveLength(0);
    expect(h.button.disabled).toBe(false);
    expect(h.button.textContent).toBe("Merge the code");
  });
});

// --- spec 99/101: the view survives the press, and the row gets the reason ---

// Merging from the page goes through this file, not through the form
// POST — so the server's redirect fix reaches nobody with JavaScript on
// unless what this file does carries the same two things. Spec 101 took
// the navigation itself out: the query the server would have redirected
// to is written with `history.replaceState` and the rows are swapped, so
// the reader keeps the page, the scroll position and the form they were
// filling in.
describe("a refused action keeps the view and names its spec (criteria 7, 8)", () => {
  const REFUSED = {
    ok: false,
    spec: "aide/99-merge-leaves-nothing-behind",
    results: [{ root: "/repos/aide-specs", error: "the tree is dirty in /repos/aide-specs" }],
  };

  test("the current filter and sort come along", async () => {
    const h = harness(
      (url) => (url.includes("/merge") ? { ok: true, body: REFUSED } : { ok: true }),
      "mergeform",
      "?state=active&sort=cost&token=s3cret",
    );
    await h.submit();
    const to = new URL(h.replaced[0]!, "http://dash.test");
    expect(to.pathname).toBe("/");
    expect(to.searchParams.get("state")).toBe("active");
    expect(to.searchParams.get("sort")).toBe("cost");
    // The token is handed over once as a cookie; carrying it back into
    // the address bar would put it in history for no reason.
    expect(to.searchParams.get("token")).toBeNull();
  });

  test("the spec the server named rides along, so the row can show it", async () => {
    const h = harness((url) => (url.includes("/merge") ? { ok: true, body: REFUSED } : { ok: true }));
    await h.submit();
    const to = new URL(h.replaced[0]!, "http://dash.test");
    expect(to.searchParams.get("errorSpec")).toBe("aide/99-merge-leaves-nothing-behind");
    expect(to.searchParams.get("error")).toContain("the tree is dirty");
  });

  test("a refusal the server did not attribute still says the reason", async () => {
    const h = harness((url) =>
      url.includes("/merge")
        ? { ok: true, body: { ok: false, results: [{ root: "/repos/aide", error: "the tree is dirty" }] } }
        : { ok: true },
    );
    await h.submit();
    const to = new URL(h.replaced[0]!, "http://dash.test");
    expect(to.searchParams.get("error")).toContain("the tree is dirty");
    expect(to.searchParams.get("errorSpec")).toBeNull();
  });

  // Spec 101, criterion 6: the message lands on the row without the
  // page moving. The rows are re-fetched with the same query the
  // address bar now holds, so the reason comes back rendered on the
  // spec it belongs to — and nothing scrolled.
  test("the page does not navigate, and the rows are re-asked with the reason", async () => {
    const h = harness((url) => (url.includes("/merge") ? { ok: true, body: REFUSED } : { ok: true }));
    await h.submit();
    expect(h.location.href).toBe("http://dash.test/");
    expect(decodeURIComponent(swapUrl(h))).toContain("errorSpec=aide/99-merge-leaves-nothing-behind");
    expect(h.rows.innerHTML).toBe("<tr></tr>");
  });
});

// A branch that outlived its own merge is what spec 92's dependency
// guard reads as "not merged yet". The JSON already carries it; the page
// has to say it out loud, in the same place the install message goes.
describe("a failed branch deletion is said on the page (criterion 4)", () => {
  test("it lands in the same note the install message uses", async () => {
    const h = harness(() => ({
      ok: true,
      body: {
        ok: true,
        results: [
          {
            root: "/repos/aide-specs",
            ok: true,
            branchDeleteError: "merged, but deleting aide/99-x on origin failed: remote rejected",
          },
        ],
      },
    }));
    await h.submit();
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]!.textContent).toContain("deleting aide/99-x on origin failed");
    expect(h.location.href).toBe("http://dash.test/");
  });

  test("both messages are said, not just the first", async () => {
    const h = harness(() => ({
      ok: true,
      body: {
        ok: true,
        results: [
          { root: "/repos/aide-specs", ok: true, branchDeleteError: "deleting the branch failed" },
          { root: "/repos/aide", ok: true, installError: "merged, not installed" },
        ],
      },
    }));
    await h.submit();
    expect(h.inserted[0]!.textContent).toContain("deleting the branch failed");
    expect(h.inserted[0]!.textContent).toContain("merged, not installed");
  });
});

// --- spec 101: every control answers the press, not only Merge --------------

// Run, Approve and Cancel were plain form posts: the browser navigated
// on the click, the button froze mid-navigation, and the redirect target
// re-rendered the whole page (a git call per spec) before anything came
// back. Same request, same route, same answer — the wait and the jump
// are what go.
describe("every action button says it was pressed (criteria 4, 5)", () => {
  const OK = { ok: true, job: { id: "job-1" } };

  for (const [formClass, pending] of [["rowrun", "starting…"], ["actionform", "approving…"]] as const) {
    test(`${formClass} changes its button before the answer arrives`, async () => {
      let seen = "";
      const h = harness(
        (url) => {
          if (url.includes("/api/queue")) seen = h.button.textContent;
          return { ok: true, body: OK };
        },
        formClass,
      );
      await h.submit();
      expect(seen).toBe(pending);
      // And it is put back when the request is over, in case the swap
      // left this very button standing.
      expect(h.button.textContent).toBe(CONTROLS[formClass]!.label);
      expect(h.button.disabled).toBe(false);
    });

    test(`${formClass} swaps the rows in place instead of navigating`, async () => {
      const h = harness(() => ({ ok: true, body: OK }), formClass);
      await h.submit();
      expect(swapUrl(h)).toContain("rows=1");
      expect(h.rows.innerHTML).toBe("<tr></tr>");
      expect(h.location.href).toBe("http://dash.test/");
    });

    test(`a refused ${formClass} lands on the row, without the page moving`, async () => {
      const h = harness(
        (url) =>
          url.includes("rows=1")
            ? { ok: true }
            : { ok: false, body: { error: "analyze is already running on this spec", spec: "aide/101-x" } },
        formClass,
      );
      await h.submit();
      const to = new URL(h.replaced[0]!, "http://dash.test");
      expect(to.searchParams.get("error")).toContain("already running");
      expect(to.searchParams.get("errorSpec")).toBe("aide/101-x");
      expect(h.location.href).toBe("http://dash.test/");
      expect(h.rows.innerHTML).toBe("<tr></tr>");
    });
  }

  // Merge needs no body; Run IS its body — the phases, the model, the
  // other repos and the gate are all in the form, and a POST that
  // dropped them would queue something else than what was ticked.
  test("Run sends the form's own fields", async () => {
    const h = harness(() => ({ ok: true, body: OK }), "rowrun");
    await h.submit();
    const post = h.requests.find((r) => r.init.method === "POST")!;
    expect(String(post.init.body)).toContain("steps=analyze");
    expect((post.init.headers as Record<string, string>)["content-type"]).toContain(
      "application/x-www-form-urlencoded",
    );
  });
});

// The one form on the page that is not about a spec that exists. It has
// no row for a refusal to land on — the spec it names was never made —
// so the reason goes beside the form the reader was typing into, rather
// than into a page-level banner above a disclosure that may well be shut.
describe("the New-spec form answers for itself (criteria 7, 8)", () => {
  test("a refusal is written beside the form, and the form stays open", async () => {
    const h = harness(() => ({ ok: false, body: { error: "no such project: nope" } }));
    await h.submitCreate();
    expect(h.slot.textContent).toContain("no such project");
    expect(h.details.open).toBe(true);
    expect(h.location.href).toBe("http://dash.test/");
    // Not the page-level banner, and no row: nothing was navigated to.
    expect(h.replaced).toHaveLength(0);
  });

  test("a created spec swaps the rows, empties the form and shuts it", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true, job: { id: "job-2" } } }));
    await h.submitCreate();
    expect(swapUrl(h)).toContain("rows=1");
    expect(h.rows.innerHTML).toBe("<tr></tr>");
    expect(h.resets).toHaveLength(1);
    expect(h.details.open).toBe(false);
    expect(h.slot.textContent).toBe("");
    expect(h.location.href).toBe("http://dash.test/");
  });

  test("the button says it is working, and its fields go with it", async () => {
    let seen = "";
    const h = harness((url) => {
      if (url.includes("/create")) seen = h.createButton.textContent;
      return { ok: true, body: { ok: true } };
    });
    await h.submitCreate();
    expect(seen).toBe("creating…");
    const post = h.requests.find((r) => r.url.includes("/create"))!;
    expect(String(post.init.body)).toContain("title=A+spec");
  });

  test("a refusal already answered by something else is left alone", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    await h.submitCreate({ defaultPrevented: true });
    expect(h.requests).toHaveLength(0);
  });
});
