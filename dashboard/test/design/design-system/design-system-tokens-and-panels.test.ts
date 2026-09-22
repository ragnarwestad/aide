// Dark mode is implemented not merely declared, the two row-state
// vocabularies stay distinct, and the row's message panel reuses the
// existing component. Split out of design-system.test.ts by theme.
import { describe, expect, test } from "bun:test";
import { renderSpecsPage, renderSpecsRows } from "../../../src/render";
import { AT, NAV, row, rows, target } from "../design-system-fixtures.ts";

// --- dark mode is implemented, not merely declared ----------------------------

// Spec 121 made New spec, on the spec list, a link rather than a
// button — it GOES somewhere and does nothing else. It wears `.btn`,
// so the component has to survive being worn by an `<a>`: the page's
// own a-rule underlines on hover, and a button that grows an underline
// under the pointer stops looking like one.
//
// /new's own Cancel wore `.btn` the same way until spec 252 unified it
// with every other page's "← Back" and gave the shared control its own
// `.backlink` styling (2026-08-27) — it is no longer a second example
// of this component.
describe("the button component works on a link too (spec 121)", () => {
  const rules = async (): Promise<[string, string]> => {
    const { CSS } = await import("../../../src/render/ui/css");
    return [
      CSS.match(/(?<![-.\w])\.btn \{[^}]*\}/)?.[0] ?? "",
      CSS.match(/\.btn:hover \{[^}]*\}/)?.[0] ?? "",
    ];
  };

  test("the rules are where this test thinks they are", async () => {
    const [rest, hover] = await rules();
    expect(rest).not.toBe("");
    expect(hover).not.toBe("");
  });

  test("it carries no underline, at rest or under the pointer", async () => {
    const [rest, hover] = await rules();
    expect(rest).toContain("text-decoration: none");
    expect(hover).toContain("text-decoration: none");
  });

  test("New spec really is a link wearing it", () => {
    const list = renderSpecsPage([], AT, NAV, {
      runnerAvailable: true,
      targets: [],
      createProjects: ["aide"],
    });
    expect(list).toContain('<a class="btn primary" href="/new">');
  });
});

describe("every token has a dark-surface value (acceptance criterion 13)", () => {
  // Contrast can only be judged in a browser. What a test CAN close is
  // that no token is left behind: a page half in dark mode is the one
  // failure mode a missing override produces.
  const PAIRED = [
    "--bg", "--surface", "--surface-2", "--text", "--muted", "--line", "--line-strong",
    "--accent", "--accent-strong", "--accent-soft", "--link", "--link-strong", "--ok", "--ok-soft",
    "--warn", "--warn-soft", "--danger", "--danger-soft",
  ];

  test("the dark block overrides every colour token", async () => {
    const { CSS } = await import("../../../src/render/ui/css");
    const dark = CSS.match(/@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(dark).not.toBe("");
    for (const token of PAIRED) expect(dark).toContain(`${token}:`);
  });

  test("the mark swaps to its dark-surface copy", async () => {
    const { CSS } = await import("../../../src/render/ui/css");
    expect(CSS).toContain(".mark-d");
    expect(CSS).toContain(".mark-l");
  });
});

// --- one name, one question ------------------------------------------------

describe("the spec list says whether a job is in flight (acceptance criterion 9)", () => {
  test("each head row carries its run state as data-run, before data-folder (AC-2)", () => {
    const head = (html: string) => html.match(/<tr class="spechead"[^>]*>/)?.[0] ?? "";
    expect(head(rows([], { targets: [target()] }))).toMatch(/^<tr class="spechead" id="[^"]*" data-run="new" data-folder="[^"]*">$/);
    expect(head(rows([row({ state: "running" })], { targets: [target()] }))).toContain('data-run="live" data-folder="');
    expect(head(rows([row({ state: "done" })], { targets: [target()] }))).toContain('data-run="past" data-folder="');
    const archivedSpec = {
      project: "aide",
      folder: "191-x",
      notLanded: false,
      done: ["create", "analyze", "implement", "archive"],
      models: {},
      phaseOutcomes: {},
    };
    const archived = rows([], {
      targets: [],
      archived: ["aide/191-x"],
      archivedSpecs: [archivedSpec],
      filter: { state: "archived" },
    });
    expect(head(archived)).toContain('data-run="archived" data-folder="191-x"');
  });

  test("no run- class is written on the row (AC-2)", () => {
    const html = rows([row({ state: "running" })], { targets: [target()] });
    expect(html).not.toMatch(/class="[^"]*\brun-/);
  });
});

// Spec 143: the panel a row's long message goes into is the message
// component the page already has, in a row of its own — not a second
// way of drawing the same thing.
describe("the row's message panel is the component, not new markup", () => {
  test("the panel wraps rowMessage and spans the whole table", () => {
    const html = rows([row({ state: "failed", error: "the specs tree is dirty: /repos/aide-specs" })], {
      targets: [target()],
    });
    const panel = html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
    // Seven since the chevron took a column of its own (2026-09-22); six
    // since the Created column joined the other five (spec 317).
    expect(panel).toContain(`<td colspan="7">`);
    expect(panel).toMatch(/class="rowmsg failed">\s*<svg/);
    // The same colspan the "no spec matches" row uses — one column
    // count for the table, not two that can drift apart. Seven since the
    // chevron took a column of its own (2026-09-22).
    const empty = renderSpecsRows([], { runnerAvailable: true, targets: [] });
    expect(empty).toContain(`colspan="7"`);
  });

  test("a held-back note is amber, like the badge that announces it", async () => {
    const html = rows([row({ state: "done", steps: ["archive"] })], {
      targets: [target({ archiveHeldBack: { reason: "the Slack webhook" } })],
    });
    const panel = html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(panel).toContain("rowmsg waiting");
    const { CSS } = await import("../../../src/render/ui/css");
    expect(CSS.match(/\.rowmsg\.waiting\s*\{([^}]*)\}/)?.[1] ?? "").toContain("var(--warn)");
  });
});

// --- spec 520: message rows come after the phase lines, inside the frame ---

describe("a message row after the phase lines is inside the open row's frame (spec 520, AC-2)", () => {
  test("list.css frames the phase lines and the message rows that follow them", async () => {
    const { CSS } = await import("../../../src/render/ui/css");
    // A frame rather than a ground since 2026-09-22: the lines keep the
    // page's own background, so a message card inside them is not a
    // grey box on a grey box, and the fold control's hover — drawn in
    // that same faint colour — stays visible.
    const sides = CSS.match(/table\.list :is\(tr\.subrow, tr\.phasemsgs\) > td:first-child,[^{]*\{[^}]*\}/)?.[0] ?? "";
    expect(sides).toContain("border-left: 1px solid var(--line)");
    expect(sides).toContain("+ tr.specnotice > td:first-child");
    const top = CSS.match(/table\.list tr\.specstate \+ :is\(tr\.subrow, tr\.phasemsgs\) > td \{[^}]*\}/)?.[0] ?? "";
    expect(top).toContain("border-top: 1px solid var(--line)");
    const bottom = CSS.match(/table\.list :is\(tr\.subrow, tr\.phasemsgs, tr\.specnotice\):is\(:last-child[^{]*\{[^}]*\}/)?.[0] ?? "";
    expect(bottom).toContain("border-bottom: 1px solid var(--line)");
    // And no row of an open spec paints a ground of its own any more.
    expect(CSS).not.toMatch(/table\.list tr\.subrow td[^{]*\{[^}]*background: var\(--surface-2\)/);
  });
});
