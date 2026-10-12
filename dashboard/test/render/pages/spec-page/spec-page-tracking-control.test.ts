// Spec 394: what belongs to the whole spec sits above the tabs — the
// acceptance switch and the settings, drawn in the banner rather than the
// Description tab's own form, on every tab.

import { describe, expect, test } from "bun:test";
import { page, view } from "../spec-page-fixtures.ts";

describe("spec 394: the banner's combined tracking control", () => {
  // REQ-6: locked, not omitted, once analyze has run.
  test("REQ-6: the switch is drawn disabled, and posts nothing, once done includes analyze", () => {
    const html = page(view({ done: ["create", "analyze"] }));
    expect(html).not.toContain('name="acceptanceRequired"');
    expect(html).not.toContain('name="settingsEditable"');
    // Still a box, and still saying which way it went.
    expect(html).toContain("Acceptance ticking required");
    expect(html).toMatch(/data-acceptance[^>]*><input[^>]*\bchecked\b[^>]*\bdisabled\b/);
  });

  // REQ-6's own criterion is testable both ways: nothing done yet draws
  // the live control.
  test("no analyze yet draws the live, editable switch", () => {
    const html = page(view({ done: [] }));
    expect(html).toMatch(/<input type="checkbox" name="acceptanceRequired"/);
  });

  const CHOICES = { acceptanceRequired: true, aiFormulate: false, criteriaChecks: "warn", chooseApproach: true } as const;

  // Before analyze has run, the three settings it reads post with the
  // switch; the AI formulation, which create has already used, does not.
  test("a live spec posts the three settings analyze reads, and not the AI formulation", () => {
    const html = page(view({ done: ["create"], createChoices: CHOICES }));
    for (const field of ["acceptanceRequired", "criteriaChecks", "chooseApproach"]) {
      expect([field, html.includes(`name="${field}"`)]).toEqual([field, true]);
    }
    expect(html).not.toContain('name="aiFormulateAcceptance"');
    expect(html).toMatch(/<select name="criteriaChecks"[^>]*>[\s\S]*?<option value="warn" selected>/);
  });

  test("once analyze has run, none of the settings posts", () => {
    const html = page(view({ done: ["create", "analyze"], createChoices: CHOICES }));
    for (const field of ["acceptanceRequired", "settingsEditable", "aiFormulateAcceptance", "criteriaChecks", "chooseApproach"]) {
      expect([field, html.includes(`name="${field}"`)]).toEqual([field, false]);
    }
  });

  test("an archived spec shows the four settings locked, with the same values, posting none (AC-5)", () => {
    const html = page(view({ archived: true, createChoices: CHOICES }));
    expect(html).toContain("Let AI formulate acceptance criteria");
    expect(html).toContain("Let me choose the approach");
    expect(html).toMatch(/<select[^>]*\bdisabled\b[^>]*>[\s\S]*?<option value="warn" selected>/);
    for (const field of ["acceptanceRequired", "settingsEditable", "aiFormulateAcceptance", "criteriaChecks", "chooseApproach"]) {
      expect([field, html.includes(`name="${field}"`)]).toEqual([field, false]);
    }
  });
});

// The Depends on picker is on the Running tab's open row; the banner holds the
// three settings alone.
describe("the banner draws no Depends on picker", () => {
  // What a view once carried for the picker. The banner reads none of it.
  const picker = {
    dependsOn: ["99-a-second-spec"],
    dependsOnOptions: [{ project: "aide", specFolder: "99-a-second-spec" }, { project: "aide", specFolder: "88-a-third-spec" }],
  };

  test("a live spec has no Depends on field before analyze, and still posts its settings (AC-5)", () => {
    const html = page(view({ done: ["create"], ...picker }));
    expect(html).not.toContain('name="dependsOn"');
    expect(html).toContain('name="settingsEditable"');
  });

  test("once analyze has run, the spec has no Depends on field and no form at all (AC-5)", () => {
    const html = page(view({ done: ["create", "analyze"], ...picker }));
    expect(html).not.toContain('name="dependsOn"');
    expect(html).not.toContain("trackingform");
  });

  test("an archived or a closed spec draws no form and no Depends on field (AC-5)", () => {
    for (const record of [{ archived: true }, { archived: true, closed: true }]) {
      const html = page(view({ ...record, ...picker }));
      expect(html).not.toContain('name="dependsOn"');
      expect(html).not.toContain("trackingform");
    }
  });
});
