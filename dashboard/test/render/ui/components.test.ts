// The shared "← Back" primitives — `backLink()`'s markup and
// `resolveBackHref()`'s same-origin resolution of the
// standard `Referer` header. No render file had a test of its own for
// either shape before this.
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  backLink, btn, btnLink, buttonForm, facts, foldArrow, helpPopover, kindIcon, KIND_ICONS, labelledCheckbox, messageSlot, resolveBackHref, shareBar, usageBar,
  tabIcon, TAB_ICONS,
  type RowKind,
  saveCancelActions,
} from "../../../src/render/ui/components";
import { TOOL_ICONS } from "../../../src/render/ui/components/icons.ts";
import { projectLink, rowLabel } from "../../../src/render/ui/components/spec-name.ts";
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

describe("backLink()", () => {
  test("asked to keep, the link carries the hook the page script finds it by; otherwise none", () => {
    expect(first(backLink("/", "Settings", "", { keep: true }), "a.backlink").hasAttribute("data-keep")).toBe(true);
    expect(first(backLink("/", "Settings"), "a.backlink").hasAttribute("data-keep")).toBe(false);
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
  test("draws a trusted icon with an accessible name and no variant (AC-12)", () => {
    const el = first(btn({ label: "", icon: '<svg data-icon="usage"></svg>', ariaLabel: "Usage", type: "button" }), "button");
    expect(el.getAttribute("class")).toBe("btn");
    expect(el.getAttribute("aria-label")).toBe("Usage");
    expect(el.querySelector("svg")?.getAttribute("data-icon")).toBe("usage");
  });
  test("carries the form it belongs to, a value, data attributes and a spoken name, every value escaped", () => {
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
  test("without the new options draws what it always drew, and the ask button as its tests pin it", () => {
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
  test("writes its pending word with a capital first letter", () => {
    expect(first(btn({ label: "Run", pending: "starting…" }), "button").getAttribute("data-pending")).toBe("Starting…");
  });
});

describe("shareBar()", () => {
  test("holds a share when reported and stays unfilled when it is not (AC-5)", () => {
    expect(first(shareBar("Claude", 76, "76% left"), "progress").getAttribute("value")).toBe("76");
    expect(first(shareBar("Claude", undefined, "Reading usage…"), "progress").hasAttribute("value")).toBe(false);
  });
});

describe("usageBar()", () => {
  test("holds the share left and writes the name and share inside the bar (AC-1)", () => {
    const html = usageBar({ name: "Claude Work", value: 58, label: "Claude Work: 58% left" });
    expect(first(html, "progress").getAttribute("value")).toBe("58");
    expect(first(html, "progress").getAttribute("aria-label")).toBe("Claude Work: 58% left");
    expect(first(html, "div").textContent).toContain("Claude Work");
    expect(first(html, "div").textContent).toContain("58%");
  });

  test("writes the countdown only when given one (AC-2)", () => {
    expect(first(usageBar({ name: "A", value: 60, label: "A", resets: "4d 21h" }), "[data-resets]").textContent).toBe("4d 21h");
    expect(first(usageBar({ name: "A", value: 60, label: "A" }), "[data-resets]")).toBeNull();
  });

  test("draws the pace mark at the even-pace share only when given one (AC-3)", () => {
    const html = usageBar({ name: "A", value: 60, label: "A", pace: 70, paceTitle: "Even pace: 70% left" });
    expect(first(html, "[data-pace] line").getAttribute("x1")).toBe("70");
    expect(first(html, "[data-pace] title").textContent).toBe("Even pace: 70% left");
    expect(first(usageBar({ name: "A", value: 60, label: "A" }), "[data-pace]")).toBeNull();
  });
});

describe("btnLink()", () => {
  test("draws a link in a button's variant, size and hook, every value escaped", () => {
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

  test("with nothing but an href and a label is a plain button link", () => {
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

  test("an id names it, for a form elsewhere on the page to write into", () => {
    expect(line(messageSlot("refused", "failed", { id: "spec-refused" }))).toEqual({
      id: "spec-refused",
      classes: ["failed", "refused", "rowmsg"],
      live: "polite",
      icon: true,
      words: "",
    });
  });

  test("with no text keeps its icon and an empty place for the words", () => {
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
  test("takes its title from the catalogue in the page's language, with the action word filled in", () => {
    const html = foldArrow({ href: "/", open: false, lang: "nb", title: "list.foldTitle", params: { folder: "12-x" } });
    const title = t("nb", "list.foldTitle", { action: t("nb", "list.foldShow"), folder: "12-x" });
    expect(html).toContain(`title="${esc(title)}"`);
  });

  test("escapes its address once and carries the hooks the list's script reads", () => {
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
  test("posts to its escaped action, carries the hook the script selects on, and its hidden fields", () => {
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

  test("closes a dialog with no action when its method is the dialog's own", () => {
    const html = buttonForm({ method: "dialog", button: { label: "OK", value: "leave" } });
    expect(attrOf(html, "form", "method")).toBe("dialog");
    expect(attrOf(html, "form", "action")).toBeUndefined();
    expect(attrOf(html, "button", "value")).toBe("leave");
  });

  test("draws a dialog's close cross, named for a screen reader, as its one button", () => {
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

describe("saveCancelActions in the reader's language", () => {
  test("Norwegian draws Save and Cancel from the catalogue (AC-5)", () => {
    const html = saveCancelActions("x", {}, "nb");
    expect(html).toContain(`>${t("nb", "list.checksSave")}<`);
    expect(html).toContain(`>${t("nb", "dialog.cancel")}<`);
  });

  test("with no language it draws English, as every caller did before (AC-5)", () => {
    expect(saveCancelActions("x")).toContain(">Cancel<");
  });
});

describe("TOOL_ICONS is keyed by the provider tools", () => {
  test("a provider tool left out of the icons is a type error (AC-3)", () => {
    // @ts-expect-error opencode is missing
    const missing = { claude: "x", codex: "x" } satisfies typeof TOOL_ICONS;
    expect(Object.keys(missing)).toHaveLength(2);
  });
});

describe("kindIcon()", () => {
  const kinds: RowKind[] = ["spec", "deploy", "schedule", "cleanup", "group"];

  test("uses the translated kind as both its accessible name and hover text (AC-4)", () => {
    const norwegian = first(kindIcon("schedule", "nb"), ".kindicon");
    expect(norwegian.getAttribute("aria-label")).toBe(t("nb", "jobs.kindSchedule"));
    expect(norwegian.getAttribute("title")).toBe(t("nb", "jobs.kindSchedule"));
    expect(first(kindIcon("schedule"), ".kindicon").getAttribute("title")).toBe("Scheduled job");
  });

  test("names every kind and uses the same word for speech and hover text (AC-4)", () => {
    for (const kind of kinds) {
      const icon = first(kindIcon(kind), ".kindicon");
      expect(icon.getAttribute("aria-label")).toBe(icon.getAttribute("title"));
      expect(icon.getAttribute("aria-label")).not.toBe("");
    }
  });

  test("every kind's icon carries its own untranslated kind for the stylesheet to colour (AC-1)", () => {
    for (const kind of kinds) {
      expect(first(kindIcon(kind), ".kindicon").getAttribute("data-kind")).toBe(kind);
    }
    expect(first(kindIcon("schedule", "nb"), ".kindicon").getAttribute("data-kind")).toBe("schedule");
  });

  test("the shared set has one distinct drawing for every kind (AC-5)", () => {
    expect(Object.keys(KIND_ICONS).sort()).toEqual([...kinds].sort());
    expect(new Set(Object.values(KIND_ICONS)).size).toBe(kinds.length);
    // @ts-expect-error group is missing
    const missing = { spec: "x", deploy: "x", schedule: "x", cleanup: "x" } satisfies typeof KIND_ICONS;
    expect(Object.keys(missing)).toHaveLength(4);
  });
});

describe("tabIcon()", () => {
  test("reuses the kind drawings for Specs and Schedule (AC-2)", () => {
    expect(TAB_ICONS.specs).toBe(KIND_ICONS.spec);
    expect(TAB_ICONS.schedule).toBe(KIND_ICONS.schedule);
  });

  test("gives Jobs and Projects drawings of their own (AC-3)", () => {
    expect(TAB_ICONS.jobs).not.toBe(TAB_ICONS.projects);
    for (const drawing of [TAB_ICONS.jobs, TAB_ICONS.projects]) {
      expect(Object.values(KIND_ICONS)).not.toContain(drawing);
    }
  });

  test("carries the tab for styling without naming the decorative icon (AC-3, AC-5)", () => {
    const icon = first(tabIcon("projects"), ".kindicon");
    expect(icon.getAttribute("data-tab")).toBe("projects");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.hasAttribute("aria-label")).toBe(false);
    expect(icon.hasAttribute("title")).toBe(false);
  });
});

describe("rowLabel()", () => {
  const label = (o: { href?: string; title?: string } = {}) =>
    parsed(rowLabel({ project: "aide", kind: "deploy", name: "deploy", lang: "en", ...o }));

  test("the project's icon and name are one link to the project's page (AC-1, AC-2, AC-5)", () => {
    const link = label().querySelector('a[href="/projects/aide"]')!;
    expect(link.querySelector('.kindicon[data-tab="projects"]')).not.toBeNull();
    expect(link.textContent).toBe("aide");
  });

  test("with an address, the kind icon and the name are one link to it (AC-1, AC-3)", () => {
    const link = label({ href: "/specs/aide/81-x#spec-aide/81-x", title: "aide:81-x" })
      .querySelector('a[href="/specs/aide/81-x#spec-aide/81-x"]')!;
    expect(link.getAttribute("title")).toBe("aide:81-x");
    expect(link.querySelector(".kindicon[data-kind]")).not.toBeNull();
    expect(link.querySelector(".specname")!.textContent).toBe("deploy");
  });

  test("without an address, no link encloses the kind icon (AC-4)", () => {
    const html = label();
    expect(html.querySelectorAll("a")).toHaveLength(1);
    expect(html.querySelector(".kindicon[data-kind]")!.closest("a")).toBeNull();
    expect(html.querySelector(".specpart .kindicon[data-kind]")).not.toBeNull();
  });

  test("the kind given is the one the icon carries for the stylesheet (AC-5)", () => {
    expect(label().querySelector(".kindicon[data-kind]")!.getAttribute("data-kind")).toBe("deploy");
  });

  test("the project link in a sentence draws no icon", () => {
    expect(parsed(projectLink("aide")).querySelector(".kindicon")).toBeNull();
  });
});
