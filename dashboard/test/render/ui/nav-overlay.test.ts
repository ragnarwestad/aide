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
  let dialog: { open: boolean; showModal: () => void; close: () => void } | null = null;
  let insertedHTML: string | null = null;
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
      };
    },
    get lastElementChild() {
      return dialog;
    },
  };
  let clickHandler: ((event: unknown) => void) | undefined;
  let submitHandler: ((event: unknown) => void) | undefined;
  const document = {
    body,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (type === "click") clickHandler = fn;
      if (type === "submit") submitHandler = fn;
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

  const form = (className: string) => ({
    matches: (sel: string) => sel === ".specform" && className === "specform",
  });

  return {
    click,
    link,
    pageshow,
    submit,
    form,
    isOpen: () => !!dialog?.open,
    wasInserted: () => insertedHTML !== null,
    insertedHTML: () => insertedHTML,
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
