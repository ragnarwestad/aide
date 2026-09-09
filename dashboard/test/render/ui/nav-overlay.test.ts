// A link that leaves the page for another document covers the whole
// page with a spinner, from the click until the new document arrives —
// the other half of what `nav-busy.ts`'s pale link leaves unsaid.
//
// `nav-overlay.ts` can neither import nor export anything — the shell
// transpiles it into the same inline classic <script> as the theme and
// nav-busy scripts — so, like them, it is transpiled and run here
// against a document (and, unlike its siblings, a window) small enough
// to state in full.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
  readFileSync(join(import.meta.dir, "..", "..", "..", "src", "render", "ui", "nav-overlay.ts"), "utf-8"),
);

const DELAY_MS = 150;

function harness() {
  let dialog: {
    open: boolean;
    showModal: () => void;
    close: () => void;
    querySelector: (sel: string) => { textContent: string; hidden: boolean } | null;
  } | null = null;
  let insertedHTML: string | null = null;
  const noteEl = { textContent: "", hidden: true };
  const body = {
    insertAdjacentHTML: (_pos: string, html: string) => {
      insertedHTML = html;
      dialog = {
        open: false,
        showModal: () => {
          dialog!.open = true;
        },
        close: () => {
          dialog!.open = false;
        },
        querySelector: (sel: string) => (sel === ".overlaynote" ? noteEl : null),
      };
    },
    get lastElementChild() {
      return dialog;
    },
    dataset: {} as Record<string, string>,
  };
  let clickHandler: ((event: unknown) => void) | undefined;
  let submitHandler: ((event: unknown) => void) | undefined;
  // Every other listener by name, so the two events the Deploy press
  // raises can be fired at this document the way the browser fires them.
  const others = new Map<string, (event: unknown) => void>();
  const document = {
    body,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (type === "click") clickHandler = fn;
      else if (type === "submit") submitHandler = fn;
      else others.set(type, fn);
    },
  };
  let pageshowHandler: ((event: unknown) => void) | undefined;
  const window = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (type === "pageshow") pageshowHandler = fn;
    },
  };
  new Function("document", "window", SOURCE)(document, window);

  const click = (
    link: { target?: string; hasAttribute?: (n: string) => boolean; getAttribute?: (n: string) => string | null } | null,
    extra: Partial<{ defaultPrevented: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; button: number }> = {},
  ) =>
    clickHandler!({
      target: {
        closest: (sel: string) => (sel === "a[href]" ? link : null),
      },
      defaultPrevented: extra.defaultPrevented ?? false,
      metaKey: extra.metaKey ?? false,
      ctrlKey: extra.ctrlKey ?? false,
      shiftKey: extra.shiftKey ?? false,
      button: extra.button ?? 0,
    });

  const link = (href: string, opts: { target?: string; download?: boolean } = {}) => ({
    target: opts.target,
    hasAttribute: (n: string) => (n === "download" ? !!opts.download : false),
    getAttribute: (n: string) => (n === "href" ? href : null),
  });

  const pageshow = (persisted: boolean) => pageshowHandler!({ persisted });

  const submit = (
    form: { matches?: (sel: string) => boolean } | null,
    extra: Partial<{ defaultPrevented: boolean }> = {},
  ) =>
    submitHandler!({
      target: form,
      defaultPrevented: extra.defaultPrevented ?? false,
    });

  const form = (className: string, overlay?: string) => ({
    matches: (sel: string) => sel === ".specform" && className === "specform",
    dataset: { overlay } as Record<string, string | undefined>,
  });

  const emit = (type: string, detail?: string) => others.get(type)?.({ type, detail });

  return {
    click,
    link,
    pageshow,
    submit,
    form,
    emit,
    body,
    isOpen: () => !!dialog?.open,
    wasInserted: () => insertedHTML !== null,
    insertedHTML: () => insertedHTML,
    noteText: () => noteEl.textContent,
    noteHidden: () => noteEl.hidden,
  };
}

describe("a link that leaves the page covers it until the new one arrives", () => {
  test("a plain click on a same-document link opens the overlay after the delay, not before", async () => {
    const h = harness();
    h.click(h.link("/other"));
    expect(h.isOpen()).toBe(false);
    await Bun.sleep(DELAY_MS + 10);
    expect(h.isOpen()).toBe(true);
  });

  test("a navigation that completes before the delay never shows the overlay", async () => {
    const h = harness();
    h.click(h.link("/other"));
    // Nothing simulates the document being replaced here — the point is
    // only that the overlay has not appeared before the delay elapses.
    expect(h.isOpen()).toBe(false);
  });

  test("opening the overlay calls showModal(), not merely a class toggle", async () => {
    const h = harness();
    h.click(h.link("/other"));
    await Bun.sleep(DELAY_MS + 10);
    expect(h.wasInserted()).toBe(true);
    expect(h.insertedHTML()).toContain("dialog");
    expect(h.isOpen()).toBe(true);
  });

  test("a synthetic click with no prior mouse movement still opens it", async () => {
    const h = harness();
    h.click(h.link("/other"), { button: 0 });
    await Bun.sleep(DELAY_MS + 10);
    expect(h.isOpen()).toBe(true);
  });

  test("a pageshow with persisted true closes the overlay and clears a pending timer", async () => {
    const h = harness();
    h.click(h.link("/other"));
    await Bun.sleep(DELAY_MS + 10);
    expect(h.isOpen()).toBe(true);
    h.pageshow(true);
    expect(h.isOpen()).toBe(false);
  });

  test("a pageshow with persisted false leaves a shown overlay alone", async () => {
    const h = harness();
    h.click(h.link("/other"));
    await Bun.sleep(DELAY_MS + 10);
    expect(h.isOpen()).toBe(true);
    h.pageshow(false);
    expect(h.isOpen()).toBe(true);
  });

  test("target=_blank schedules nothing", async () => {
    const h = harness();
    h.click(h.link("/other", { target: "_blank" }));
    await Bun.sleep(DELAY_MS + 10);
    expect(h.isOpen()).toBe(false);
  });

  test("a modifier or middle click schedules nothing", async () => {
    const h = harness();
    h.click(h.link("/other"), { metaKey: true });
    h.click(h.link("/other"), { ctrlKey: true });
    h.click(h.link("/other"), { shiftKey: true });
    h.click(h.link("/other"), { button: 1 });
    await Bun.sleep(DELAY_MS + 10);
    expect(h.isOpen()).toBe(false);
  });

  test("a download link schedules nothing", async () => {
    const h = harness();
    h.click(h.link("/file.zip", { download: true }));
    await Bun.sleep(DELAY_MS + 10);
    expect(h.isOpen()).toBe(false);
  });

  test("a hash-only href schedules nothing", async () => {
    const h = harness();
    h.click(h.link("#section"));
    await Bun.sleep(DELAY_MS + 10);
    expect(h.isOpen()).toBe(false);
  });

  test("a mailto: or tel: href schedules nothing", async () => {
    const h = harness();
    h.click(h.link("mailto:a@b.com"));
    h.click(h.link("tel:12345"));
    await Bun.sleep(DELAY_MS + 10);
    expect(h.isOpen()).toBe(false);
  });

  test("a click already spoken for (defaultPrevented) schedules nothing", async () => {
    const h = harness();
    h.click(h.link("/other"), { defaultPrevented: true });
    await Bun.sleep(DELAY_MS + 10);
    expect(h.isOpen()).toBe(false);
  });

  test("a click on a link with no data-goto attribute is still matched (REQ-7)", async () => {
    const h = harness();
    // The tab bar's own markup carries data-nav/data-goto, but this
    // script's matcher is a[href] — it does not require either
    // attribute, which is exactly what lets it reach links that were
    // never opted in.
    h.click(h.link("/spec?tab=logs"));
    await Bun.sleep(DELAY_MS + 10);
    expect(h.isOpen()).toBe(true);
  });

  // Spec 422, REQ-1: a bare overlay reads as broken on a navigation that
  // takes a moment — the page's own default note, rendered onto <body>
  // once per request, is what a script that can neither import nor
  // export otherwise has no way to reach.
  test("a plain click shows the page's own default note, read off document.body.dataset (spec 422)", async () => {
    const h = harness();
    h.body.dataset.overlayNote = "loading…";
    h.click(h.link("/other"));
    await Bun.sleep(DELAY_MS + 10);
    expect(h.isOpen()).toBe(true);
    expect(h.noteText()).toBe("loading…");
    expect(h.noteHidden()).toBe(false);
  });
});

// Spec 391, REQ-8: a Save form's own submit covers the page the same
// way a navigating link does — immediately, not after the click
// listener's delay, since a Save always commits and pushes for real.
describe("a Save form's submit covers the page until the answer comes back (REQ-8)", () => {
  test("submitting form.specform opens the overlay with no delay", () => {
    const h = harness();
    h.submit(h.form("specform"));
    expect(h.isOpen()).toBe(true);
  });

  // Spec 422, REQ-1/REQ-2: the submitted form's own data-overlay is what
  // names the operation — the same pattern press.ts already reads a
  // form's pending text off.
  test("submitting form.specform shows the form's own data-overlay text (spec 422)", () => {
    const h = harness();
    h.submit(h.form("specform", "lagrer…"));
    expect(h.isOpen()).toBe(true);
    expect(h.noteText()).toBe("lagrer…");
    expect(h.noteHidden()).toBe(false);
  });

  test("submitting a form without the specform class does nothing", () => {
    const h = harness();
    h.submit(h.form("otherform"));
    expect(h.isOpen()).toBe(false);
  });

  test("a submit already spoken for (defaultPrevented) does nothing", () => {
    const h = harness();
    h.submit(h.form("specform"), { defaultPrevented: true });
    expect(h.isOpen()).toBe(false);
  });

  test("a submit while a click's own timer is still pending shares that guard, and opens nothing yet", () => {
    const h = harness();
    h.click(h.link("/other"));
    h.submit(h.form("specform"));
    // Both listeners share the same `timer`/`dialog` state: a submit
    // that lands while a click's delay is still counting down declines,
    // exactly as a second click would. The click's own timer still
    // opens the overlay once it elapses (proven elsewhere in this file).
    expect(h.isOpen()).toBe(false);
  });
});

// Deploy is not a navigation, so none of the above reaches it — but it
// takes the page away just as thoroughly: the service restarts under it
// and the page reloads when the server answers again. It asks for this
// same layer by event, rather than a second one of its own.
describe("the covering layer can be asked for by event, for work that is not a navigation", () => {
  test("an aide-overlay-open event covers the page at once, with no delay to wait out", () => {
    const h = harness();
    h.emit("aide-overlay-open", "deploying…");
    expect(h.isOpen()).toBe(true);
  });

  test("the layer has a place for the note a wait this long needs", () => {
    const h = harness();
    h.emit("aide-overlay-open", "deploying…");
    expect(h.insertedHTML()).toContain('class="overlaynote"');
    expect(h.insertedHTML()).toContain('class="spin"');
  });

  test("an aide-overlay-close event uncovers it again — a refused deploy leaves the page to be read", () => {
    const h = harness();
    h.emit("aide-overlay-open", "deploying…");
    h.emit("aide-overlay-close");
    expect(h.isOpen()).toBe(false);
  });

  test("closing one that was never opened does nothing", () => {
    const h = harness();
    h.emit("aide-overlay-close");
    expect(h.isOpen()).toBe(false);
  });

  test("a link click already waiting out its delay is overtaken, not queued behind", async () => {
    const h = harness();
    h.click(h.link("/projects"));
    h.emit("aide-overlay-open", "deploying…");
    expect(h.isOpen()).toBe(true);
    await new Promise((r) => setTimeout(r, DELAY_MS + 20));
    expect(h.isOpen()).toBe(true);
  });
});
