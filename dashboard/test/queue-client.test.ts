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
import { SPINNER } from "../src/render/components.ts";

const RAW = readFileSync(join(import.meta.dir, "..", "src", "queue-client.ts"), "utf-8");
const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(RAW);

interface Reply {
  ok: boolean;
  body?: unknown;
  throws?: boolean;
  /** Hold the request open until this settles — for what happens
   *  WHILE a press is in flight. */
  hold?: Promise<void>;
  /** What a row-refresh answers with. Named per reply because spec 129
   *  is about WHICH of two answers reaches `#jobrows`, so the two have
   *  to be told apart once they are both in the air. */
  text?: string;
}

/** What each control is called before and during its request, and which
 *  form it is drawn in. The wording is the server's (`data-pending` in
 *  the markup); the harness only has to carry it the way the DOM would.
 *
 *  Keyed by CONTROL, not by form class: `actionForm` renders Approve and
 *  Cancel as two separate `<form class="actionform">` elements
 *  (`queue-list.ts`), told apart by route, label and variant and never
 *  by class — so a table keyed by class could only ever test one of
 *  them. The `variant` is what the server put on the button before the
 *  press, which is the thing `busy` has to replace. */
const CONTROLS: Record<
  string,
  { label: string; pending: string; action: string; formClass: string; variant: string }
> = {
  mergeform: {
    label: "Merge", pending: "merging…", formClass: "mergeform", variant: "primary",
    action: "http://dash.test/api/queue/job-1/merge",
  },
  rowrun: {
    label: "Run", pending: "starting…", formClass: "rowrun", variant: "primary",
    action: "http://dash.test/api/queue",
  },
  actionform: {
    label: "Approve", pending: "approving…", formClass: "actionform", variant: "ok",
    action: "http://dash.test/api/queue/job-1/approve",
  },
  cancel: {
    label: "Cancel", pending: "cancelling…", formClass: "actionform", variant: "danger",
    action: "http://dash.test/api/queue/job-1/cancel",
  },
};

/** `className` and `classList` over one string, the way the DOM keeps
 *  them: the code under test reads one and writes the other, and a fake
 *  where those two disagree could not tell "busy replaced the variant"
 *  from "busy was added beside it". */
function classes(el: { className: string }) {
  const set = () => new Set(el.className.split(" ").filter(Boolean));
  const write = (s: Set<string>) => void (el.className = [...s].join(" "));
  return {
    add: (c: string) => write(set().add(c)),
    remove: (c: string) => {
      const s = set();
      s.delete(c);
      write(s);
    },
    contains: (c: string) => set().has(c),
  };
}

/** One button in one form in `#jobrows`, the New-spec form beside it,
 *  and the globals the file actually touches. Nothing here pretends to
 *  be a browser: it answers the handful of questions the code asks, and
 *  records what it was asked to do. */
function harness(
  reply: (url: string) => Reply,
  control_ = "mergeform",
  search = "",
  o: { collapsed?: boolean; pathname?: string } = {},
) {
  const control = CONTROLS[control_]!;
  const formClass = control.formClass;
  const button = {
    textContent: control.label,
    // What the server drew it as. A fake with no starting class could
    // not prove the variant is REMOVED when the busy look goes on.
    className: `btn ${control.variant}`,
    classList: {} as ReturnType<typeof classes>,
    innerHTML: "",
    title: "",
    disabled: false,
    isConnected: true,
    dataset: { pending: control.pending },
    insertAdjacentHTML: (where: string, html: string) => {
      button.innerHTML = where === "afterbegin" ? html + button.innerHTML : button.innerHTML + html;
    },
  };
  button.classList = classes(button);
  // The row's phase boxes — the space this spec's spinner takes over
  // while the press is out. A COLLAPSED row (spec 103) has none: it
  // renders Approve or Merge alone, with no run form and no boxes.
  const boxes = "<label class=\"phase\">analyze</label>";
  // `offsetWidth` is the one thing a hand-built object cannot honestly
  // report — nothing here lays anything out. It is a stated number, and
  // what the test proves is that the code READS it and holds the space
  // it names, not how many pixels a browser would have said.
  const phases = { innerHTML: boxes, isConnected: true, offsetWidth: 168, style: { minWidth: "" } };
  const otherPhases = { innerHTML: boxes, isConnected: true, offsetWidth: 168, style: { minWidth: "" } };
  /** Since spec 124 the boxes are on the phase LINES and the buttons
   *  on the header row, so a button's own `<tr>` has none to lend —
   *  and the code stopped asking. Every selector it does ask for is
   *  recorded, so a lookup creeping back is a failed test rather than
   *  a spinner appearing in the "also touches" chips beside the
   *  button. */
  const rowQueries: string[] = [];
  const row = {
    querySelector: (sel: string) => {
      rowQueries.push(sel);
      return null;
    },
  };
  const tokenInput = { value: "s3cret" };
  const form = {
    action: control.action,
    className: formClass,
    // The phase boxes ARE the Run form's fields — a real `FormData`
    // reads the checkboxes that are in the form at that moment. So the
    // fake reads them out of the same element the press overwrites: a
    // spinner put there before the form was serialised would post a job
    // with no phases at all, and a fixed list could not tell.
    get fields(): [string, string][] {
      const ticked: [string, string][] = phases.innerHTML.includes("phase") ? [["steps", "analyze"]] : [];
      return [...ticked, ["view.state", "active"]];
    },
    querySelectorAll: () => [button],
    querySelector: (sel: string) => (sel.includes("token") ? tokenInput : null),
    closest: (sel: string) => (sel === "tr" ? row : sel.includes(`.${formClass}`) ? form : null),
  };

  // The New-spec form is the whole of `/new` since spec 121 — no
  // #jobrows beside it and no disclosure around it — so it is bound
  // directly rather than by delegation, a second code path tested as
  // one.
  const createButton = {
    textContent: "Create",
    className: "btn primary",
    classList: {} as ReturnType<typeof classes>,
    innerHTML: "",
    title: "",
    disabled: false,
    isConnected: true,
    dataset: { pending: "creating…" },
    insertAdjacentHTML: (_where: string, html: string) => void (createButton.innerHTML += html),
  };
  createButton.classList = classes(createButton);
  const slot = { textContent: "" };
  const resets: number[] = [];
  // Spec 110's Depends-on chips: one wrapper per active spec, each
  // naming its own project, plus the Project select they are scoped to.
  // `reset()` reverts the select the way the browser's own does —
  // silently, without firing `change`, which is the whole reason the
  // reset path needs a re-sync of its own.
  const projectSelect = { value: "aide", addEventListener: (t: string, fn: (e: unknown) => void) => void (on[`select:${t}`] = fn) };
  const chip = (project: string) => {
    const input = { checked: true, disabled: false };
    return {
      dataset: { project },
      getAttribute: (name: string) => (name === "data-project" ? project : null),
      hidden: false,
      querySelector: (sel: string) => (sel.includes("input") ? input : null),
      input,
    };
  };
  const chips = [chip("aide"), chip("aide-dashboard")];

  // Spec 127: the row's own AI select, and the five phase model selects
  // it narrows. `<option>` collections are new scaffolding here — the
  // chips above are checkbox/wrapper pairs and model nothing a select
  // needs (a value that IS one of its options, and a selection that
  // moves when the one it points at is hidden).
  const ROW_FORM = "rowrun-aide/127-one-ai";
  const MODELS: [string, string][] = [
    ["sonnet", "claude"],
    ["fable", "claude"],
    ["codex-fast", "codex"],
  ];
  const modelSelect = (step: string, chosen: string) => {
    const options = MODELS.map(([value, tool]) => ({
      value,
      dataset: { tool },
      hidden: false,
      selected: value === chosen,
    }));
    return {
      name: `model.${step}`,
      options,
      getAttribute: (n: string) => (n === "form" ? ROW_FORM : null),
      get selectedOptions() {
        return options.filter((o) => o.selected);
      },
      // A real select's value IS its selected option: writing one moves
      // the other, which is the whole of what the reselection does.
      get value() {
        return options.find((o) => o.selected)?.value ?? "";
      },
      set value(v: string) {
        for (const o of options) o.selected = o.value === v;
      },
    };
  };
  const modelSelects = [
    modelSelect("create", "sonnet"),
    modelSelect("analyze", "fable"),
    modelSelect("review-plan", "sonnet"),
    modelSelect("implement", "codex-fast"),
    modelSelect("archive", "sonnet"),
  ];
  /** A model select belonging to ANOTHER row: the filter must reach the
   *  five that share its form id and no others. */
  const otherRowSelect = { ...modelSelect("analyze", "fable"), getAttribute: () => "rowrun-aide/99-other" };
  const toolSelect = {
    value: "claude",
    getAttribute: (n: string) => (n === "form" ? ROW_FORM : null),
    closest: (sel: string) => (sel.includes("data-tool-picker") ? toolSelect : null),
  };
  const createForm = {
    action: "http://dash.test/api/queue/create",
    fields: [["project", "aide"], ["title", "A spec"]] as [string, string][],
    querySelectorAll: (sel: string) =>
      sel.includes("data-project") ? (chips as unknown as typeof createButton[]) : [createButton],
    querySelector: (sel: string) =>
      sel.includes("token")
        ? tokenInput
        : sel.includes("refused")
          ? slot
          : sel.includes("project")
            ? projectSelect
            : null,
    // Nothing wraps this form on `/new` — the page IS the form. A fake
    // that still handed a `<details>` back would let a re-added
    // panel-close pass unnoticed.
    closest: () => null,
    reset: () => {
      resets.push(1);
      projectSelect.value = "aide";
    },
    addEventListener: (type: string, fn: (e: unknown) => void) => void (on[`create:${type}`] = fn),
  };

  // Spec 112's Projects panel: one Remove form, with the typed
  // confirmation the browser gates its button on. The button is
  // rendered ENABLED by the server — turning it off is this code's job,
  // and a fake that started it disabled could not tell the two apart.
  const removeButton = {
    textContent: "Remove",
    title: "",
    disabled: false,
    dataset: { pending: "removing…" },
    className: "btn danger",
    isConnected: true,
    insertAdjacentHTML: () => {},
  } as unknown as typeof createButton & { disabled: boolean };
  removeButton.classList = classes(removeButton);
  const confirmInput = { value: "" } as { value: string; addEventListener?: unknown };
  const confirmWrap = {
    getAttribute: (name: string) => (name === "data-confirm" ? "atlasaurus" : null),
    querySelector: (sel: string) => (sel.includes("input") ? confirmInput : removeButton),
  };
  const removeSlot = { textContent: "" };
  const removeForm = {
    action: "http://dash.test/api/queue/projects/atlasaurus/remove",
    fields: [["confirm", "atlasaurus"]] as [string, string][],
    querySelectorAll: () => [removeButton],
    querySelector: (sel: string) =>
      sel.includes("data-confirm")
        ? confirmWrap
        : sel.includes("token")
          ? tokenInput
          : sel.includes("refused")
            ? removeSlot
            : null,
    closest: () => null,
    addEventListener: (type: string, fn: (e: unknown) => void) => void (on[`remove:${type}`] = fn),
  };
  let typed: (() => void) | undefined;
  confirmInput.addEventListener = (type: string, fn: () => void) => {
    if (type === "input") typed = fn;
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
  // `pathname` because the page's own reloads go back to the page they
  // are on — the Projects panel is served at `/projects` since spec 115,
  // and a hardcoded `/` would throw the reader onto the spec list.
  const location = { search, href: "http://dash.test/", pathname: o.pathname ?? "/" };
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
    // `.phases` answers with ANOTHER row's boxes on purpose: a press
    // must reach its own row's boxes and no others, so a document-wide
    // lookup has to be visibly wrong rather than accidentally right.
    querySelector: (sel: string) =>
      sel.includes("newspecform") ? createForm : sel.includes("phases") ? otherPhases : null,
    // Spec 112 binds its panel's forms as a SET, the same way it is
    // rendered: one Add form and one Remove per allowlisted project.
    // A form-scoped selector answers only the selects that name that
    // form — the DOM's own answer, and the one thing a fake that
    // handed back every select on the page could not tell apart.
    querySelectorAll: (sel: string) =>
      sel.includes("removeform")
        ? [removeForm]
        : sel.includes("model.")
          ? [...modelSelects, otherRowSelect].filter((s) => sel.includes(`form="${s.getAttribute("form")}"`))
          : [],
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
      text: async () => r.text ?? "<tr></tr>",
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
    replaced, slot, resets, document, phases, otherPhases, rowQueries, tick: () => tick(),
    projectSelect, chips,
    removeButton, removeSlot, confirmInput,
    submitRemove: (extra: Partial<{ defaultPrevented: boolean }> = {}) =>
      fire("remove:submit", removeButton, extra),
    /** What the reader typing in the confirmation field does. */
    type: (value: string) => {
      confirmInput.value = value;
      typed?.();
    },
    changeProject: (value: string) => {
      projectSelect.value = value;
      on["select:change"]?.({ target: projectSelect });
    },
    modelSelects, otherRowSelect, toolSelect,
    changeTool: (value: string) => {
      toolSelect.value = value;
      on["change"]?.({ target: toolSelect });
    },
    /** A change on something in the table that is NOT the AI select. */
    changeOther: () =>
      on["change"]?.({ target: { closest: () => null } }),
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

  // Spec 104: it says so by CHANGING, not by changing its word. The
  // pending wording is still the server's, and still shown — as the
  // button's `title`, where it costs no width.
  test("the button says so at once, instead of looking untouched (criterion 10)", async () => {
    let seenBusy = false;
    let seenTitle = "";
    const h = harness((url) => {
      if (url.includes("/merge")) {
        seenBusy = h.button.classList.contains("busy");
        seenTitle = h.button.title;
      }
      return { ok: true, body: OK_MERGE };
    });
    await h.submit();
    expect(seenBusy).toBe(true);
    expect(seenTitle).toBe("merging…");
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
  // window put back an untouched "Merge" over the "merging…"
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
    expect(h.button.classList.contains("busy")).toBe(true);
    release();
    await pressed;
    // Once the answer is in, the rows are fetched (criterion 11) — once.
    expect(h.requests.filter((r) => r.url.includes("rows=1"))).toHaveLength(1);
    h.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.requests.filter((r) => r.url.includes("rows=1"))).toHaveLength(2);
  });

  // The reload keeps the reader's view: a press that failed while the
  // server restarted used to land on a bare `/`, and the sort and
  // filter they had set were gone (seen 2026-08-19: "Spec ▴" reset to
  // "Started ▾" with no press of theirs).
  test("a merge that cannot be sent at all reloads rather than lying — and keeps the view (criterion 12)", async () => {
    const h = harness(() => ({ ok: false, throws: true }), "mergeform", "?sort=spec&dir=asc");
    await h.submit();
    expect(h.location.href).toBe("/?sort=spec&dir=asc");
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
    expect(h.button.textContent).toBe("Merge");
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

  // The no-JS redirect carries errorReason; the XHR path lost it, so
  // the resolve button never appeared for anyone with JS on — seen on
  // 109 and 112, 2026-08-19.
  test("a conflict refusal carries errorReason=conflict into the view", async () => {
    const h = harness(() => ({
      ok: false,
      body: { ok: false, spec: "109-x", results: [{ error: "cannot merge (conflict)", reason: "conflict" }] },
    }));
    await h.submit();
    const url = h.replaced[h.replaced.length - 1] ?? "";
    expect(url).toContain("errorReason=conflict");
    expect(url).toContain("errorSpec=109-x");
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

  for (const formClass of ["rowrun", "actionform"] as const) {
    test(`${formClass} changes its button before the answer arrives`, async () => {
      let seen = false;
      const h = harness(
        (url) => {
          if (url.includes("/api/queue")) seen = h.button.classList.contains("busy");
          return { ok: true, body: OK };
        },
        formClass,
      );
      await h.submit();
      expect(seen).toBe(true);
      // And it is put back when the request is over, in case the swap
      // left this very button standing.
      expect(h.button.textContent).toBe(CONTROLS[formClass]!.label);
      expect(h.button.classList.contains("busy")).toBe(false);
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

// The one form that is not about a spec that exists. It has no row for
// a refusal to land on — the spec it names was never made — so the
// reason goes beside the form the reader was typing into.
describe("the New-spec form answers for itself (criteria 7, 8)", () => {
  test("a refusal is written beside the form, and the reader stays on the page", async () => {
    const h = harness(() => ({ ok: false, body: { error: "no such project: nope" } }));
    await h.submitCreate();
    expect(h.slot.textContent).toContain("no such project");
    // Still on `/new`, with everything typed still typed.
    expect(h.location.href).toBe("http://dash.test/");
    expect(h.resets).toHaveLength(0);
    expect(h.replaced).toHaveLength(0);
  });

  // Spec 121, criterion 8. The form has a page of its own now: there is
  // no panel to shut, no #jobrows beside it to swap, and the thing the
  // reader asked to see — the new spec's row, with its progress — is on
  // the page this navigates to.
  test("a created spec takes the reader back to the list", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true, job: { id: "job-2" } } }));
    await h.submitCreate();
    expect(h.location.href).toBe("/");
    // Nothing is put back in place first: the reader has left.
    expect(h.resets).toHaveLength(0);
    expect(h.requests.some((r) => r.url.includes("rows=1"))).toBe(false);
  });

  // Spec 104 changed what the four ROW buttons do while their request
  // is out, and deliberately left this one alone: it has no row to
  // shift and no phase boxes to lend their space, so the word it swaps
  // to costs nothing.
  test("the button says it is working, and its fields go with it", async () => {
    let seen = "";
    let seenBusy = false;
    const h = harness((url) => {
      if (url.includes("/create")) {
        seen = h.createButton.textContent;
        seenBusy = h.createButton.classList.contains("busy");
      }
      return { ok: true, body: { ok: true } };
    });
    await h.submitCreate();
    expect(seen).toBe("creating…");
    expect(seenBusy).toBe(false);
    const post = h.requests.find((r) => r.url.includes("/create"))!;
    expect(String(post.init.body)).toContain("title=A+spec");
  });

  test("a refusal already answered by something else is left alone", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    await h.submitCreate({ defaultPrevented: true });
    expect(h.requests).toHaveLength(0);
  });
});

// --- spec 110: the Depends-on chips follow the chosen project ----------------

// A dependency is resolved inside ONE specs root, so a chip belonging to
// another project is not a choice anyone can make. The server refuses it
// either way; this is the half that means nobody has to be refused to
// find out.
describe("the Depends-on chips are scoped to the chosen project", () => {
  test("only the chosen project's chips are live, from the moment the page loads", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    expect(h.chips[0]!.hidden).toBe(false);
    expect(h.chips[0]!.input.disabled).toBe(false);
    expect(h.chips[1]!.hidden).toBe(true);
    expect(h.chips[1]!.input.disabled).toBe(true);
  });

  test("changing the project swaps which ones are live, and unticks what it hides", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.chips[0]!.input.checked = true;
    h.changeProject("aide-dashboard");
    expect(h.chips[0]!.hidden).toBe(true);
    expect(h.chips[0]!.input.disabled).toBe(true);
    // A hidden box the reader can no longer see is not a choice they
    // are still making.
    expect(h.chips[0]!.input.checked).toBe(false);
    expect(h.chips[1]!.hidden).toBe(false);
    expect(h.chips[1]!.input.disabled).toBe(false);
  });

  // Spec 121 retired the re-sync that used to follow a create: the
  // success path navigates now, so there is no reset to chase and no
  // half-cleared form to leave behind. What the reader picked stands
  // until the browser leaves the page.
  test("a successful create leaves them alone — the page is on its way out", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true, job: { id: "job-2" } } }));
    h.changeProject("aide-dashboard");
    expect(h.chips[1]!.hidden).toBe(false);
    await h.submitCreate();
    expect(h.location.href).toBe("/");
    expect(h.projectSelect.value).toBe("aide-dashboard");
    expect(h.chips[1]!.hidden).toBe(false);
  });
});

// --- spec 104: a pressed button keeps its width -----------------------------

// The press used to rewrite the button's word — "Run" became "starting…",
// "Cancel" became "cancelling…" — and the button grew or shrank to fit,
// which shoved the whole row sideways at the one moment it should look
// most in control. It says the same thing by changing its LOOK instead,
// to the busy variant the server already renders for a job in flight,
// and the spinner takes the space the phase boxes were using: they are
// idle while a press is out, and they come back with the next render.
describe("a pressed row button holds its size (spec 104)", () => {
  const OK = { ok: true, job: { id: "job-1" } };

  for (const control of ["rowrun", "actionform", "cancel", "mergeform"] as const) {
    test(`${control} swaps to the busy look without changing its label`, async () => {
      const { label, variant } = CONTROLS[control]!;
      let seen = { label: "", busy: false, variant: true, spinner: "" };
      const h = harness(
        (url) => {
          if (url.includes("/api/queue")) {
            seen = {
              label: h.button.textContent,
              busy: h.button.classList.contains("busy"),
              variant: h.button.classList.contains(variant),
              spinner: h.button.innerHTML,
            };
          }
          return { ok: true, body: OK };
        },
        control,
      );
      await h.submit();
      // The word on the button is the word it had. Nothing that decides
      // the button's width changed, so the width could not.
      expect(seen.label).toBe(label);
      expect(seen.busy).toBe(true);
      // In PLACE of the variant, not beside it: two variants at once is
      // a button with two looks.
      expect(seen.variant).toBe(false);
      // ONE spinner per row, inside the button that was pressed: since
      // spec 124 the phase boxes are on lines of their own and have no
      // space to lend.
      expect(seen.spinner).toContain(SPINNER);
    });
  }

  // The pending word is not lost, only moved off the label: `title` is
  // where it costs no width. (A screen reader hears the press as the
  // button being disabled — see the spec's risk note.)
  test("the server's pending word rides along as the button's title", async () => {
    let seen = "";
    const h = harness((url) => {
      if (url.includes("/api/queue")) seen = h.button.title;
      return { ok: true, body: OK };
    }, "rowrun");
    await h.submit();
    expect(seen).toBe("starting…");
  });

  // Spec 124: there are no boxes to borrow any more — the phase boxes
  // are on the phase LINES, and every button on the row is on the
  // header. So the spinner goes where it always went on a collapsed
  // row: inside the button that was pressed, for every control alike.
  for (const control of ["rowrun", "actionform", "cancel", "mergeform"] as const) {
    test(`${control} carries its own spinner, and asks no row for boxes`, async () => {
      let seen = { busy: false, spinner: "" };
      const h = harness((url) => {
        if (url.includes("/api/queue")) {
          seen = { busy: h.button.classList.contains("busy"), spinner: h.button.innerHTML };
        }
        return { ok: true, body: OK };
      }, control);
      await h.submit();
      expect(seen.busy).toBe(true);
      expect(seen.spinner).toContain(SPINNER);
      // The row is still asked for nothing at all: the "also touches"
      // chips now share the button's own `<tr>`, and a `.phases`
      // lookup would put the spinner in them.
      expect(h.rowQueries.filter((q) => q.includes("phases"))).toEqual([]);
    });
  }

  // The boxes are the Run form's own fields wherever they are drawn,
  // and the press must not disturb them: a spinner written over them
  // before the form is serialised posts a job with no phases at all.
  test("the phase boxes are left alone by a press", async () => {
    let seen = "";
    const h = harness((url) => {
      if (url.includes("/api/queue")) seen = h.phases.innerHTML;
      return { ok: true, body: OK };
    }, "rowrun");
    await h.submit();
    expect(seen).toContain('class="phase"');
    expect(h.phases.style.minWidth).toBe("");
    expect(String(h.requests[0]!.init.body)).toContain("steps=analyze");
  });

  // Nothing puts the boxes back by hand: every path out of a press ends
  // in the rows being re-asked from the server, which draws whatever is
  // true NOW — the boxes, or the busy chips of the job that just
  // started. Both halves of "success or refusal" go through it.
  test("the boxes come back with the server's own answer, on success", async () => {
    const h = harness(() => ({ ok: true, body: OK }), "rowrun");
    await h.submit();
    expect(swapUrl(h)).toContain("rows=1");
    expect(h.rows.innerHTML).toBe("<tr></tr>");
  });

  test("and on a refusal, which redraws the same way", async () => {
    const h = harness(
      (url) =>
        url.includes("rows=1")
          ? { ok: true }
          : { ok: false, body: { error: "analyze is already running", spec: "aide/104-x" } },
      "rowrun",
    );
    await h.submit();
    expect(swapUrl(h)).toContain("rows=1");
    expect(h.rows.innerHTML).toBe("<tr></tr>");
  });

  // The redraw is what puts the boxes back — but a redraw that fails
  // (server restarting, tailnet hiccup) leaves the row standing, and a
  // row left holding a spinner for something that is over is worse than
  // the shove this spec set out to fix.
  test("a redraw that never arrives puts the button back itself", async () => {
    const h = harness((url) => (url.includes("rows=1") ? { ok: false } : { ok: true, body: OK }), "rowrun");
    await h.submit();
    expect(h.rows.innerHTML).toBe("");
    expect(h.button.textContent).toBe("Run");
    expect(h.button.classList.contains("busy")).toBe(false);
    expect(h.button.classList.contains("primary")).toBe(true);
  });

  // `queue-client.ts` can neither import nor export (the server
  // transpiles it into an inline script), so the spinner it writes is a
  // hand-copied literal. Nothing but this would notice the two drifting
  // apart — one file cannot even name the other.
  test("the spinner it writes is the one components.ts renders", () => {
    expect(RAW).toContain(SPINNER);
  });
});

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
      "mergeform",
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
    expect(bound).toEqual(["submit"]);
  });
});

// --- spec 127: the row's AI select narrows its model selects ----------------

// One control for the row instead of five: picking the AI hides the
// other tool's models everywhere on that row at once. The row's own
// consequence, accepted when it was asked for — a row can no longer be
// half Claude Code and half Codex through the UI.
//
// It runs on CHANGE and never on load: the server has already pre-filled
// every phase select with what that phase last ran on, and a filter that
// ran by itself would re-pick for phases nobody touched.
describe("the row's AI select filters its model selects (spec 127)", () => {
  const hidden = (h: ReturnType<typeof harness>) =>
    h.modelSelects.map((s) => s.options.filter((o) => o.hidden).map((o) => o.value));

  test("nothing is filtered until the reader changes it", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    expect(hidden(h)).toEqual([[], [], [], [], []]);
    expect(h.modelSelects.map((s) => s.value)).toEqual([
      "sonnet", "fable", "sonnet", "codex-fast", "sonnet",
    ]);
  });

  test("choosing Codex hides every claude option, on all five selects", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeTool("codex");
    for (const select of h.modelSelects) {
      for (const option of select.options) {
        expect([option.value, option.hidden]).toEqual([option.value, option.dataset.tool !== "codex"]);
      }
    }
  });

  test("a selection the change hides moves to one still on offer", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeTool("codex");
    // Every phase now shows the codex entry — including the four that
    // were showing a claude model a moment ago.
    expect(h.modelSelects.map((s) => s.value)).toEqual([
      "codex-fast", "codex-fast", "codex-fast", "codex-fast", "codex-fast",
    ]);
    // And no select is left pointing at something out of sight.
    for (const select of h.modelSelects) {
      expect([select.name, select.selectedOptions[0]?.hidden]).toEqual([select.name, false]);
    }
  });

  test("changing back offers the claude models again", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeTool("codex");
    h.changeTool("claude");
    expect(hidden(h)).toEqual([
      ["codex-fast"], ["codex-fast"], ["codex-fast"], ["codex-fast"], ["codex-fast"],
    ]);
    // The one phase that was on codex takes the first claude option; the
    // four that were reassigned keep whatever they were left holding.
    for (const select of h.modelSelects) {
      expect([select.name, select.value]).toEqual([select.name, "sonnet"]);
    }
  });

  // The selects are tied to their form by ATTRIBUTE, not by nesting
  // (they are written outside its tags), so the lookup is form-scoped
  // rather than a walk of the row.
  test("another row's model select is left alone", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeTool("codex");
    expect(h.otherRowSelect.options.some((o) => o.hidden)).toBe(false);
    expect(h.otherRowSelect.value).toBe("fable");
  });

  // Delegated on #jobrows, like every other control on the table: the
  // rows are replaced wholesale every five seconds, and a listener bound
  // to the select itself would last exactly one tick.
  test("it answers a change on the container, and ignores every other one", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    // A change on something that is not the AI select — a phase's own
    // model select, say — reaches the same delegated listener and must
    // pass straight through it.
    h.changeOther();
    expect(hidden(h)).toEqual([[], [], [], [], []]);
    // The listener the container recorded IS the one that filters.
    h.changeTool("codex");
    expect(hidden(h)[0]).toEqual(["sonnet", "fable"]);
  });
});

// --- spec 129: an answer older than the press never lands on top of it -------
//
// `inFlight` stops a NEW swap from STARTING while a press runs. It says
// nothing about one that was already in the air when the press began:
// that request carries the server's answer from BEFORE the press, and
// on resolving wrote it straight into `#jobrows` — over the busy button
// the press had just drawn, or over the refusal banner it had just
// asked for.
//
// The window is wide, not theoretical. Every `/?rows=1` answer waits on
// `isMerged()` for every branch of every listed job, and a cache miss
// there costs up to three sequential git calls at four seconds each —
// which is the 10-15 seconds of a Merge button sitting unchanged that
// was measured on 2026-08-20.
describe("a swap older than the press is discarded, not applied (spec 129)", () => {
  /** What the server said BEFORE the press, and what must never reach
   *  the page after it. */
  const STALE = "<tr>before the press</tr>";
  /** What it says once the press is accounted for. */
  const FRESH = "<tr>after the press</tr>";

  /** Enough microtask turns for a released `hold` to run the rest of
   *  `swapRows` — the fetch, the `text()`, the assignment. Counted
   *  rather than awaited because `tick()` drops its promise on purpose
   *  (a listener's return value is nobody's to wait on). */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  test("a tick's answer arriving mid-press does not put the untouched row back", async () => {
    let releaseTick: () => void = () => {};
    const tickHeld = new Promise<void>((r) => (releaseTick = r));
    let releaseMerge: () => void = () => {};
    const mergeHeld = new Promise<void>((r) => (releaseMerge = r));
    const h = harness((url) =>
      url.includes("/merge")
        ? { ok: true, body: OK_MERGE, hold: mergeHeld }
        : { ok: true, text: STALE, hold: tickHeld },
    );
    h.document.visibilityState = "visible";
    // The tick goes first and its answer is held open — nothing about
    // this request will ever know a press happened.
    h.tick();
    await Promise.resolve();
    expect(h.requests.filter((r) => r.url.includes("rows=1"))).toHaveLength(1);
    // Then the press, while that request is still in the air.
    const pressed = h.submit();
    await Promise.resolve();
    expect(h.button.classList.contains("busy")).toBe(true);
    // Now the tick answers, with the row exactly as it was before.
    releaseTick();
    await flush();
    // Writing that into #jobrows is what replaced the busy button with
    // the untouched one the server still believed in.
    expect(h.rows.innerHTML).toBe("");
    expect(h.button.classList.contains("busy")).toBe(true);
    releaseMerge();
    await pressed;
  });

  test("a tick's answer arriving after a refusal does not wipe the reason", async () => {
    let releaseTick: () => void = () => {};
    const tickHeld = new Promise<void>((r) => (releaseTick = r));
    const REFUSED = {
      ok: false,
      spec: "aide/129-the-merge-button-answers-the-press",
      results: [{ root: "/repos/aide", error: "cannot fast-forward main in /repos/aide — merge it by hand" }],
    };
    const h = harness((url) => {
      if (url.includes("/merge")) return { ok: true, body: REFUSED };
      // The refusal's OWN swap asks with the reason in the query
      // string (`showRefusal` put it there): that answer is the current
      // one, and it is the one that must survive.
      if (url.includes("errorSpec")) return { ok: true, text: FRESH };
      return { ok: true, text: STALE, hold: tickHeld };
    });
    h.document.visibilityState = "visible";
    h.tick();
    await Promise.resolve();
    await h.submit();
    expect(h.rows.innerHTML).toBe(FRESH);
    // The tick finally answers — from before the press was even made.
    releaseTick();
    await flush();
    expect(h.rows.innerHTML).toBe(FRESH);
  });

  // The guard must discard a STALE answer and nothing else: a tick that
  // raced nobody still has to redraw the table, which is the whole
  // reason the tick exists.
  test("with no press racing it, the tick's answer lands as it always did", async () => {
    const h = harness(() => ({ ok: true, text: STALE }));
    h.document.visibilityState = "visible";
    h.tick();
    await flush();
    expect(h.rows.innerHTML).toBe(STALE);
  });
});
