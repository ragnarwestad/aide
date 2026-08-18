// Spec 96: the page's own merge submit. Pressing Merge used to be a
// plain form POST — several seconds with nothing changing on the button,
// then a 303 back to the list and a reload that threw the reader to the
// top of the page.
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
}

/** One button in one form in `#jobrows`, and the four globals the file
 *  actually touches. Nothing here pretends to be a browser: it answers
 *  the handful of questions the code asks, and records what it was
 *  asked to do. */
function harness(reply: (url: string) => Reply, formClass = "mergeform", search = "") {
  const button = { textContent: "Merge the code", disabled: false, isConnected: true };
  const tokenInput = { value: "s3cret" };
  const form = {
    action: "http://dash.test/api/queue/job-1/merge",
    className: formClass,
    querySelectorAll: () => [button],
    querySelector: (sel: string) => (sel.includes("token") ? tokenInput : null),
    closest: (sel: string) => (sel.includes(formClass) ? form : null),
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

  const document = {
    getElementById: (id: string) => (id === "jobrows" ? rows : null),
    createElement: () => ({ id: "", className: "", textContent: "" }),
    addEventListener: () => {},
    visibilityState: "hidden",
  };
  const fetchStub = async (url: unknown, init: Record<string, unknown> = {}) => {
    const at = String(url);
    requests.push({ url: at, init });
    const r = reply(at);
    if (r.throws) throw new Error("offline");
    return {
      ok: r.ok,
      json: async () => r.body,
      text: async () => "<tr></tr>",
    };
  };

  // eslint-disable-next-line no-new-func -- the file under test IS a script
  new Function("document", "location", "fetch", "setInterval", "history", SOURCE)(
    document,
    location,
    fetchStub,
    () => 0,
    { replaceState: () => {} },
  );

  const submit = (extra: Partial<{ defaultPrevented: boolean }> = {}) => {
    let prevented = extra.defaultPrevented ?? false;
    const event = {
      target: button,
      get defaultPrevented() {
        return prevented;
      },
      preventDefault: () => {
        prevented = true;
      },
    };
    // The button is what a click lands on; `closest` walks up to the form.
    (button as unknown as { closest: (s: string) => unknown }).closest = form.closest;
    return on.submit!(event) as unknown as Promise<void>;
  };

  return { submit, button, requests, location, rows, inserted };
}

const OK_MERGE = { ok: true, results: [{ root: "/repos/aide", ok: true }] };

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
    expect(h.requests.map((r) => r.url).some((u) => u.startsWith("/?") && u.includes("rows=1"))).toBe(true);
    expect(h.rows.innerHTML).toBe("<tr></tr>");
  });

  test("a refused merge falls back to the page's own error banner (criterion 12)", async () => {
    const h = harness((url) =>
      url.includes("/merge")
        ? { ok: true, body: { ok: false, results: [{ root: "/repos/aide", error: "the tree is dirty" }] } }
        : { ok: true },
    );
    await h.submit();
    expect(h.location.href).toContain("/?error=");
    expect(decodeURIComponent(h.location.href)).toContain("the tree is dirty");
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
    expect(h.inserted[0]!.className).toBe("refusal");
    expect(h.location.href).toBe("http://dash.test/");
  });

  test("an install that said nothing leaves no banner behind", async () => {
    const h = harness(() => ({ ok: true, body: OK_MERGE }));
    await h.submit();
    expect(h.inserted).toHaveLength(0);
  });

  // The override form asks confirm() from its own onsubmit and cancels
  // the event when the answer is no. A delegated handler that ignored
  // that would merge anyway — the opposite of what the dialog is for.
  test("a cancelled confirmation merges nothing", async () => {
    const h = harness(() => ({ ok: true, body: OK_MERGE }), "mergeoverride");
    await h.submit({ defaultPrevented: true });
    expect(h.requests).toHaveLength(0);
    expect(h.button.disabled).toBe(false);
    expect(h.button.textContent).toBe("Merge the code");
  });
});

// --- spec 99: the view survives the press, and the row gets the reason ------

// Merging from the page goes through this file, not through the form
// POST — so the server's redirect fix reaches nobody with JavaScript on
// unless the navigation this file performs carries the same two things.
describe("a refused merge keeps the view and names its spec (criteria 7, 8)", () => {
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
    const to = new URL(h.location.href, "http://dash.test");
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
    const to = new URL(h.location.href, "http://dash.test");
    expect(to.searchParams.get("errorSpec")).toBe("aide/99-merge-leaves-nothing-behind");
    expect(to.searchParams.get("error")).toContain("the tree is dirty");
  });

  test("a refusal the server did not attribute still navigates with the reason", async () => {
    const h = harness((url) =>
      url.includes("/merge")
        ? { ok: true, body: { ok: false, results: [{ root: "/repos/aide", error: "the tree is dirty" }] } }
        : { ok: true },
    );
    await h.submit();
    const to = new URL(h.location.href, "http://dash.test");
    expect(to.searchParams.get("error")).toContain("the tree is dirty");
    expect(to.searchParams.get("errorSpec")).toBeNull();
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
