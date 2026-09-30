// Spec 252: the shared "← Back" primitives — `backLink()`'s markup and
// `resolveBackHref()`'s same-origin resolution of the
// standard `Referer` header. No render file had a test of its own for
// either shape before this.
import { describe, expect, test } from "bun:test";
import {
  btn, btnLink, buttonForm, foldArrow, ICON_FAILED, ICON_INFO, messageSlot, resolveBackHref,
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

describe("btn()", () => {
  test("carries the form it belongs to, a value, data attributes and a spoken name, every value escaped (AC-1)", () => {
    const html = btn({
      label: "Delete",
      type: "button",
      variant: "danger",
      form: 'rowrun-a"b',
      value: "le<ave",
      data: { hook: "", ask: 'x"y' },
      ariaLabel: 'Delete "nightly"',
    });
    expect(html).toBe(
      '<button type="button" class="btn danger" form="rowrun-a&quot;b" value="le&lt;ave" ' +
        'data-hook="" data-ask="x&quot;y" aria-label="Delete &quot;nightly&quot;">Delete</button>',
    );
  });

  // Characterisation: the options above change nothing for a call without them.
  test("without the new options draws what it always drew, and the ask button as its tests pin it (AC-1)", () => {
    expect(btn({ id: "f-save", label: "Save", variant: "primary", pending: "saving…", title: "t", disabled: true })).toBe(
      '<button id="f-save" type="submit" class="btn primary" data-pending="Saving…" title="t" disabled>Save</button>',
    );
    expect(btn({ label: "Close", type: "button", data: { ask: "closeask" } })).toBe(
      '<button type="button" class="btn" data-ask="closeask">Close</button>',
    );
  });

  // Characterisation: the component already capitalises; the hand-written copies did not.
  test("writes its pending word with a capital first letter (AC-5)", () => {
    expect(btn({ label: "Run", pending: "starting…" })).toContain('data-pending="Starting…"');
  });
});

describe("btnLink()", () => {
  test("draws a link in a button's variant, size and hook, every value escaped (AC-2)", () => {
    expect(
      btnLink({
        href: "/projects/a?x=1&y=2",
        label: "Remove <it>",
        variant: "primary",
        small: true,
        hook: "proj-row-action",
        data: { "discard-changes": "" },
      }),
    ).toBe(
      '<a class="btn primary small proj-row-action" href="/projects/a?x=1&amp;y=2" data-discard-changes="">' +
        "Remove &lt;it&gt;</a>",
    );
  });

  test("with nothing but an href and a label is a plain button link (AC-2)", () => {
    expect(btnLink({ href: "/new", label: "New spec" })).toBe('<a class="btn" href="/new">New spec</a>');
  });
});

describe("messageSlot()", () => {
  test("starts with a text: announced, with the kind's icon and the words escaped and capitalised (AC-3)", () => {
    expect(messageSlot("refused", "failed", { text: "bad <b>" })).toBe(
      `<p class="refused rowmsg failed" aria-live="polite">${ICON_FAILED}<span>Bad &lt;b&gt;</span></p>`,
    );
    expect(messageSlot("notice", "info", { text: "Defaults saved" })).toBe(
      `<p class="notice rowmsg info" aria-live="polite">${ICON_INFO}<span>Defaults saved</span></p>`,
    );
  });

  test("with no text keeps its icon and an empty place for the words (AC-3)", () => {
    expect(messageSlot("refused")).toBe(
      `<p class="refused rowmsg failed" aria-live="polite">${ICON_FAILED}<span></span></p>`,
    );
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

describe("buttonForm()", () => {
  test("puts its hidden fields and its button inside the form, which carries the hook the script selects on (AC-4)", () => {
    const html = buttonForm({
      action: "/api/queue/j1/cancel?a=1&b=2",
      hook: "actionform",
      hidden: { f_state: 'all"' },
      button: { label: "Cancel" },
    });
    expect(html.startsWith('<form method="post" action="/api/queue/j1/cancel?a=1&amp;b=2" class="actionform">')).toBe(true);
    expect(html).toContain('<input type="hidden" name="f_state" value="all&quot;">');
    expect(html).toContain(btn({ label: "Cancel" }));
    expect(html.endsWith("</form>")).toBe(true);
  });

  test("closes a dialog with no action when its method is the dialog's own (AC-4)", () => {
    const html = buttonForm({ method: "dialog", button: { label: "OK", value: "leave" } });
    expect(html).toBe(`<form method="dialog">${btn({ label: "OK", value: "leave" })}</form>`);
  });

  test("draws a dialog's close cross, named for a screen reader, as its one button (AC-4)", () => {
    const html = buttonForm({ method: "dialog", button: { cross: "Close" } });
    expect(html.startsWith('<form method="dialog"><button')).toBe(true);
    expect(html).toContain('aria-label="Close"');
    expect(html).not.toContain("action=");
  });
});
