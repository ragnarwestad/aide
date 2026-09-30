// Spec 252: the shared "← Back" primitives — `backLink()`'s markup and
// `resolveBackHref()`'s same-origin resolution of the
// standard `Referer` header. No render file had a test of its own for
// either shape before this.
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  btn, btnLink, buttonForm, facts, foldArrow, helpPopover, labelledCheckbox, messageSlot, resolveBackHref,
} from "../../../src/render/ui/components";
import { esc } from "../../../src/render/ui/html.ts";
import { t } from "../../../src/i18n";

describe("resolveBackHref", () => {
  const ORIGIN = "https://dash.example";

  test("a same-origin referer is kept — path and query survive", () => {
    expect(resolveBackHref(`${ORIGIN}/?state=all&q=archive`, ORIGIN, "/")).toBe("/?state=all&q=archive");
  });

  test("no referer at all falls back", () => {
    expect(resolveBackHref(null, ORIGIN, "/fallback")).toBe("/fallback");
  });

  // Criterion 5.
  test("a foreign-origin referer is discarded, not followed", () => {
    expect(resolveBackHref("https://evil.example/", ORIGIN, "/fallback")).toBe("/fallback");
  });

  // Behind the HTTPS proxy the board is reached through, the browser's
  // own `Referer` says https and the server's request says http: the
  // proxy ends TLS and forwards to `127.0.0.1:8788`. Comparing the
  // scheme threw every "← Back" on that address onto the fallback, and
  // took a reader who stopped a test server off the page they were on.
  // The same rule the admission check already follows: host and port,
  // never the scheme (`serve-helpers/request-guard.ts`).
  test("a proxy that ended TLS is the same origin — the scheme is not compared", () => {
    expect(resolveBackHref("https://dash.example/test-servers", "http://dash.example", "/fallback")).toBe(
      "/test-servers",
    );
  });

  test("a different port is a different origin, scheme or no scheme", () => {
    expect(resolveBackHref("https://dash.example:8443/x", "http://dash.example", "/fallback")).toBe("/fallback");
  });

  test("a malformed referer falls back rather than throwing", () => {
    expect(resolveBackHref("not a url", ORIGIN, "/fallback")).toBe("/fallback");
  });
});

// --- the button, the button link and the message line -----------------------

/** The first element `selector` finds in the markup, parsed. */
const first = (html: string, selector: string): Element => parsed(html).querySelector(selector)!;

/** An element's attributes by name, in any order, as the browser reads them. */
const attrs = (el: Element): Record<string, string> =>
  Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]));

/** The same, with the class list sorted: which classes, not their order. */
const shape = (el: Element): Record<string, string> => ({ ...attrs(el), class: el.className.split(" ").sort().join(" ") });

describe("btn()", () => {
  test("carries the form it belongs to, a value, data attributes and a spoken name, every value escaped (AC-1)", () => {
    const el = first(
      btn({
        label: "Delete",
        type: "button",
        variant: "danger",
        form: 'rowrun-a"b',
        value: "le<ave",
        data: { hook: "", ask: 'x"y' },
        ariaLabel: 'Delete "nightly"',
      }),
      "button",
    );
    // Each value comes back whole: an unescaped quote would have cut it short.
    expect(shape(el)).toEqual({
      type: "button",
      class: "btn danger",
      form: 'rowrun-a"b',
      value: "le<ave",
      "data-hook": "",
      "data-ask": 'x"y',
      "aria-label": 'Delete "nightly"',
    });
    expect(el.textContent).toBe("Delete");
  });

  // Characterisation: the options above change nothing for a call without them.
  test("without the new options draws what it always drew, and the ask button as its tests pin it (AC-1)", () => {
    const save = first(btn({ id: "f-save", label: "Save", variant: "primary", pending: "saving…", title: "t", disabled: true }), "button");
    expect(shape(save)).toEqual({
      id: "f-save",
      type: "submit",
      class: "btn primary",
      "data-pending": "Saving…",
      title: "t",
      disabled: "",
    });
    const close = first(btn({ label: "Close", type: "button", data: { ask: "closeask" } }), "button");
    expect(attrs(close)).toEqual({ type: "button", class: "btn", "data-ask": "closeask" });
  });

  // Characterisation: the component already capitalises; the hand-written copies did not.
  test("writes its pending word with a capital first letter (AC-5)", () => {
    expect(first(btn({ label: "Run", pending: "starting…" }), "button").getAttribute("data-pending")).toBe("Starting…");
  });
});

describe("btnLink()", () => {
  test("draws a link in a button's variant, size and hook, every value escaped (AC-2)", () => {
    const el = first(
      btnLink({
        href: "/projects/a?x=1&y=2",
        label: "Remove <it>",
        variant: "primary",
        small: true,
        hook: "proj-row-action",
        data: { "discard-changes": "" },
      }),
      "a",
    );
    expect(el.className.split(" ").sort()).toEqual(["btn", "primary", "proj-row-action", "small"]);
    expect(el.getAttribute("href")).toBe("/projects/a?x=1&y=2");
    expect(el.getAttribute("data-discard-changes")).toBe("");
    expect(el.textContent).toBe("Remove <it>");
  });

  test("with nothing but an href and a label is a plain button link (AC-2)", () => {
    const el = first(btnLink({ href: "/new", label: "New spec" }), "a");
    expect(attrs(el)).toEqual({ class: "btn", href: "/new" });
    expect(el.textContent).toBe("New spec");
  });
});

describe("messageSlot()", () => {
  /** What the page script and a screen reader find in a line. */
  const line = (html: string) => {
    const p = first(html, "p");
    return {
      id: p.getAttribute("id"),
      classes: p.className.split(" ").sort(),
      live: p.getAttribute("aria-live"),
      icon: p.querySelector("svg") !== null,
      words: p.querySelector("span")?.textContent,
    };
  };

  test("an id names it, for a form elsewhere on the page to write into (AC-6)", () => {
    expect(line(messageSlot("refused", "failed", { id: "spec-refused" }))).toEqual({
      id: "spec-refused",
      classes: ["failed", "refused", "rowmsg"],
      live: "polite",
      icon: true,
      words: "",
    });
  });

  test("with no text keeps its icon and an empty place for the words (AC-3)", () => {
    expect(line(messageSlot("refused"))).toEqual({
      id: null,
      classes: ["failed", "refused", "rowmsg"],
      live: "polite",
      icon: true,
      words: "",
    });
  });
});

// --- the fold arrow and the one-button form -----------------------------------

describe("foldArrow()", () => {
  test("takes its title from the catalogue in the page's language, with the action word filled in (AC-1)", () => {
    const html = foldArrow({ href: "/", open: false, lang: "nb", title: "list.foldTitle", params: { folder: "12-x" } });
    const title = t("nb", "list.foldTitle", { action: t("nb", "list.foldShow"), folder: "12-x" });
    expect(html).toContain(`title="${esc(title)}"`);
  });

  test("escapes its address once and carries the hooks the list's script reads (AC-1)", () => {
    const html = foldArrow({
      href: "/?open=a&checks=b",
      open: true,
      lang: "en",
      title: "list.checksFoldTitle",
      params: { folder: "12-x" },
      data: { fold: "open", key: "aide/12-x" },
    });
    expect(html).toContain('href="/?open=a&amp;checks=b"');
    expect(html).not.toContain("&amp;amp;");
    expect(html).toContain('data-fold="open"');
    expect(html).toContain('data-key="aide/12-x"');
  });
});

/** The value of `name` on the first tag in `html` that opens with `tag`. */
const attrOf = (html: string, tag: string, name: string): string | undefined =>
  html.match(new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`))?.[1];

/** Each hidden field's name and its (escaped) value, in any attribute order. */
const hiddenFields = (html: string): Record<string, string> =>
  Object.fromEntries(
    [...html.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)].map((m) => [
      attrOf(m[0], "input", "name") ?? "",
      attrOf(m[0], "input", "value") ?? "",
    ]),
  );

describe("buttonForm()", () => {
  test("posts to its escaped action, carries the hook the script selects on, and its hidden fields (AC-4)", () => {
    const html = buttonForm({
      action: "/api/queue/j1/cancel?a=1&b=2",
      hook: "actionform",
      hidden: { f_state: 'all"' },
      button: { label: "Cancel" },
    });
    expect(attrOf(html, "form", "method")).toBe("post");
    expect(attrOf(html, "form", "action")).toBe("/api/queue/j1/cancel?a=1&amp;b=2");
    expect(attrOf(html, "form", "class")?.split(" ")).toContain("actionform");
    expect(hiddenFields(html)).toEqual({ f_state: "all&quot;" });
    expect(html).toContain(btn({ label: "Cancel" }));
  });

  test("closes a dialog with no action when its method is the dialog's own (AC-4)", () => {
    const html = buttonForm({ method: "dialog", button: { label: "OK", value: "leave" } });
    expect(attrOf(html, "form", "method")).toBe("dialog");
    expect(attrOf(html, "form", "action")).toBeUndefined();
    expect(attrOf(html, "button", "value")).toBe("leave");
  });

  test("draws a dialog's close cross, named for a screen reader, as its one button (AC-4)", () => {
    const html = buttonForm({ method: "dialog", button: { cross: "Close" } });
    expect(attrOf(html, "form", "method")).toBe("dialog");
    expect(attrOf(html, "form", "action")).toBeUndefined();
    expect(attrOf(html, "button", "aria-label")).toBe("Close");
  });
});

/** The markup parsed into a document's body. */
function parsed(html: string): HTMLElement {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document.body as unknown as HTMLElement;
}

describe("facts()", () => {
  test("marks a row's value as a figure only when the row asks for it", () => {
    const body = parsed(facts([{ label: "Cost", value: "$1.20", num: true }, { label: "Model", value: "opus" }]));
    const values = [...body.querySelectorAll("tr")].map((tr) => tr.children[1]!.classList.contains("num"));
    expect(values).toEqual([true, false]);
  });
});

describe("labelledCheckbox()", () => {
  test("open, a click on its words ticks the box: both sit in one label", () => {
    const box = parsed(labelledCheckbox({ label: "Reset", name: "resetFiles", value: "1" })).querySelector("input")!;
    expect(box.closest("label")?.textContent).toBe("Reset");
  });

  test("disabled, its help popover is never inside a label, and the box is off", () => {
    const body = parsed(labelledCheckbox({ label: "Reset", disabled: true, help: helpPopover("Why", "Because.") }));
    expect(body.querySelector("details")?.closest("label")).toBeNull();
    expect(body.querySelector("input")?.disabled).toBe(true);
  });

  test("neither variant takes the acceptance row's squeezed checkbox class", () => {
    for (const disabled of [false, true]) {
      const body = parsed(labelledCheckbox({ label: "Reset", disabled }));
      expect(body.querySelector(".checkbox")).toBeNull();
    }
  });
});
