// Dark mode is implemented not merely declared, the two row-state
// vocabularies stay distinct, and the row's message panel reuses the
// existing component. Split out of design-system.test.ts by theme.
import { describe, expect, test } from "bun:test";
import { renderQueuePage, renderQueueRows } from "../src/render.ts";
import { AT, NAV, row, rows, target } from "./design-system-fixtures.ts";

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
    const { CSS } = await import("../src/render/ui/css.ts");
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
    const list = renderQueuePage([], AT, NAV, {
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
    "--accent", "--accent-strong", "--accent-soft", "--ok", "--ok-soft",
    "--warn", "--warn-soft", "--danger", "--danger-soft",
  ];

  test("the dark block overrides every colour token", async () => {
    const { CSS } = await import("../src/render/ui/css.ts");
    const dark = CSS.match(/@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(dark).not.toBe("");
    for (const token of PAIRED) expect(dark).toContain(`${token}:`);
  });

  test("the mark swaps to its dark-surface copy", async () => {
    const { CSS } = await import("../src/render/ui/css.ts");
    expect(CSS).toContain(".mark-d");
    expect(CSS).toContain(".mark-l");
  });
});

// --- one name, one question ------------------------------------------------

// `active` and `archived` used to be two class names meaning two
// unrelated things: on the spec list, whether a job is in flight; on a
// project page, whether the spec folder has been archived on disk.
// Nothing pinned either, so nothing would have noticed them drifting
// into each other.
describe("the two row-state vocabularies are distinct (acceptance criterion 9)", () => {
  test("the spec list says whether a job is in flight", () => {
    expect(rows([], { targets: [target()] })).toContain('class="spechead run-new"');
    expect(rows([row({ state: "running" })], { targets: [target()] })).toContain(
      'class="spechead run-live"',
    );
    expect(rows([row({ state: "done" })], { targets: [target()] })).toContain(
      'class="spechead run-past"',
    );
  });

  // The generated project page had two spec-row classes of its own,
  // `spec-open` and `spec-archived`, kept distinct from the queue's
  // `active`/`archived`. That page went on 2026-08-22 and the classes
  // with it; the queue's vocabulary is the only one left.
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
    // Six since the Created column joined the other five (spec 317).
    expect(panel).toContain(`<td colspan="6">`);
    expect(panel).toMatch(/class="rowmsg failed">\s*<svg/);
    // The same colspan the "no spec matches" row uses — one column
    // count for the table, not two that can drift apart.
    const empty = renderQueueRows([], { runnerAvailable: true, targets: [] });
    expect(empty).toContain(`colspan="6"`);
  });

  test("a held-back note is amber, like the badge that announces it", async () => {
    const html = rows([row({ state: "done", steps: ["archive"] })], {
      targets: [target({ archiveHeldBack: { reason: "the Slack webhook" } })],
    });
    const panel = html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(panel).toContain("rowmsg waiting");
    const { CSS } = await import("../src/render/ui/css.ts");
    expect(CSS.match(/\.rowmsg\.waiting\s*\{([^}]*)\}/)?.[1] ?? "").toContain("var(--warn)");
  });
});
