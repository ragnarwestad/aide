// Spec 391: Save (and, beside it, Cancel) sit on the same line as the
// tab's own help mark — the form's first meaningful child, ahead of the
// field the form saves — on the Checks tab and every document tab
// (REQ-1, REQ-3, REQ-6, REQ-7, REQ-9, REQ-11). One shared markup shape,
// `saveCancelActions()`/`.panelhead` (`components.ts`, `panels.ts`,
// `overview.ts`), rather than a variation per tab.

import { describe, expect, test } from "bun:test";
import type { SpecCheckView, SpecPageView } from "../../../src/render.ts";
import { page, view } from "./spec-page-fixtures.ts";

const CHECK_ROW: SpecCheckView = {
  phase: "Acceptance criteria",
  line: "| Manual check | ⬜ | |",
  task: "Manual check",
  done: false,
};

const withChecks = (extra: Partial<SpecPageView> = {}) =>
  view({ checks: { rows: [CHECK_ROW], phase: "Acceptance criteria", baseSha: "abc123" }, ...extra });

/** The document tabs that still SAVE. `status` is not one of them:
 *  `4-status.md` is the run's own record, read-only since the Checks tab
 *  gained the untick that was the last thing a hand edit could do. */
const DOC_TABS = ["description", "analysis", "solution"] as const;

/** The one `.panelhead` div on the tab's own panel. */
const panelhead = (html: string): string => html.match(/<div class="panelhead">[\s\S]*?<\/div>/)?.[0] ?? "";

describe("spec 391: Save/Cancel sit beside the tab's own mark, not below the field (REQ-1, REQ-9, REQ-11)", () => {
  test("Checks: .panelhead is the form's first child, holds the mark and the Save/Cancel pair, ahead of the list", () => {
    const html = page(withChecks(), "checks");
    const form = html.match(/<form class="specform"[\s\S]*?<\/form>/)?.[0] ?? "";
    expect(form).not.toBe("");
    // The panelhead div is the first thing after the hidden fields —
    // nothing with visible content precedes it inside the form.
    const afterHidden = form.replace(/^[\s\S]*name="statusBaseSha"[^>]*>/, "");
    expect(afterHidden.trimStart().startsWith('<div class="panelhead">')).toBe(true);
    const head = panelhead(form);
    expect(head).toContain('<p class="checkshead">');
    expect(head).toContain('id="specform-save"');
    expect(head).toContain('id="specform-cancel"');
    // Nothing Save/Cancel-shaped remains after the list.
    expect(form.indexOf('id="specform-save"')).toBeLessThan(form.indexOf('<ul class="checklist">'));
    expect(form.slice(form.indexOf("</ul>"))).not.toContain('id="specform-save"');
  });

  for (const tab of DOC_TABS) {
    test(`${tab}: .panelhead is the form's first child, holds the mark and the Save/Cancel pair, ahead of the textarea`, () => {
      const html = page(view(), tab);
      const form = html.match(/<form method="post"[\s\S]*?<\/form>/)?.[0] ?? "";
      expect([tab, form]).not.toEqual([tab, ""]);
      const afterHidden = form.replace(/^[\s\S]*name="baseSha"[^>]*>/, "");
      expect([tab, afterHidden.trimStart().startsWith('<div class="panelhead">')]).toEqual([tab, true]);
      const head = panelhead(form);
      expect([tab, head]).not.toEqual([tab, ""]);
      expect([tab, head.includes("<h2>")]).toEqual([tab, true]);
      expect([tab, head.includes('id="specform-save"')]).toEqual([tab, true]);
      expect([tab, head.includes('id="specform-cancel"')]).toEqual([tab, true]);
      expect([tab, form.indexOf('id="specform-save"') < form.indexOf("<textarea")]).toEqual([tab, true]);
    });
  }
});

describe("spec 391: Cancel sits right after Save, disabled by default; Save carries none (REQ-3, REQ-7, REQ-10)", () => {
  const cases = [
    ["checks", () => page(withChecks(), "checks")],
    ...DOC_TABS.map((tab) => [tab, () => page(view(), tab)] as const),
  ] as const;

  for (const [tab, render] of cases) {
    test(`${tab}: Save has no disabled attribute; Cancel does, and follows Save`, () => {
      const html = render();
      // The LAST actions row, not the first: the tracking form above the
      // tabs has its own Save/Cancel pair now (spec 394's form), and
      // this test is about the document form's.
      const rows = html.match(/<span class="factions">[\s\S]*?<\/span>/g) ?? [];
      const factions = rows[rows.length - 1] ?? "";
      expect([tab, factions]).not.toEqual([tab, ""]);
      const saveTag = factions.match(/<button[^>]*id="specform-save"[^>]*>/)?.[0] ?? "";
      const cancelTag = factions.match(/<button[^>]*id="specform-cancel"[^>]*>/)?.[0] ?? "";
      expect([tab, saveTag]).not.toEqual([tab, ""]);
      expect([tab, cancelTag]).not.toEqual([tab, ""]);
      expect([tab, saveTag.includes("disabled")]).toEqual([tab, false]);
      expect([tab, cancelTag.includes("disabled")]).toEqual([tab, true]);
      expect([tab, factions.indexOf('id="specform-save"') < factions.indexOf('id="specform-cancel"')]).toEqual([
        tab,
        true,
      ]);
    });
  }
});

// `4-status.md` is a record: the run's own stamp and its log of what it
// did. The Checks tab owns the one thing in it a person decides, and
// can now take a check back off as well as put one on, so the document
// tab has nothing left to offer an editor for.
describe("the Status tab is read-only", () => {
  test("it shows the file and offers no Save form", () => {
    const html = page(view({ files: [{ label: "4-status.md", text: "# X - Status\n" }] }), "status");
    expect(html).toContain("4-status.md");
    // The page's own stylesheet names the editor's classes whether or
    // not one is mounted, so the claim is about the FORM: no save form
    // on the panel means no field, no editor and no Save.
    expect(html).not.toContain('<form method="post"');
    expect(html).not.toContain('name="text"');
  });

  test("the Description tab still has its Save form", () => {
    const html = page(view({ files: [{ label: "1-description.md", text: "# X - Description\n" }] }), "description");
    expect(html).toContain('<form method="post"');
    expect(html).toContain('name="text"');
  });
});
