// Spec 394: what belongs to the whole spec sits above the tabs — the
// depends-on picker and the acceptance switch, drawn together in the
// banner rather than the Description tab's own form, on every tab.

import { describe, expect, test } from "bun:test";
import type { SpecTarget } from "../../../../src/render";
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

// Spec 635: the Depends on picker is back in the banner's form.
describe("the banner's Depends on picker", () => {
  const spec = (specFolder: string): SpecTarget => ({ project: "aide", specFolder });
  const SECOND = "99-a-second-spec";
  const THIRD = "88-a-third-spec";
  const OLD = "80-archived";
  const withPicker = (extra: Parameters<typeof view>[0] = {}) =>
    view({ dependsOn: [SECOND], dependsOnOptions: [spec(SECOND), spec(THIRD)], ...extra });
  /** The names of the inputs inside the banner's tracking form. */
  const posted = (html: string): string[] => {
    const form = html.match(/<form class="trackingform[\s\S]*?<\/form>/)?.[0] ?? "";
    return [...form.matchAll(/<input[^>]*\bname="([^"]+)"/g)].map((m) => m[1]!);
  };
  const chip = (html: string, folder: string) =>
    html.match(new RegExp(`<input[^>]*name="dependsOn"[^>]*value="${folder}"[^>]*>`))?.[0] ?? "";

  test("a live spec analyze has not run on draws a picker with its dependency ticked, and an empty entry (AC-1)", () => {
    const html = page(withPicker({ done: ["create"] }));
    expect(chip(html, SECOND)).toMatch(/\bchecked\b/);
    expect(chip(html, THIRD)).not.toMatch(/\bchecked\b/);
    expect(html).toContain('<input type="hidden" name="dependsOn" value="">');
    expect(posted(html)).toContain("settingsEditable");
  });

  test("once analyze has run, the form is drawn with the picker alone, and posts none of the settings (AC-1)", () => {
    const html = page(withPicker({ done: ["create", "analyze"] }));
    expect(chip(html, SECOND)).toMatch(/\bchecked\b/);
    expect(html).toContain('<input type="hidden" name="dependsOn" value="">');
    const names = posted(html);
    expect(names).toContain("dependsOn");
    for (const field of ["settingsEditable", "acceptanceRequired", "criteriaChecks", "chooseApproach"]) {
      expect([field, names.includes(field)]).toEqual([field, false]);
    }
  });

  test("a spec alone in its project, depending on nothing, gets no picker, and no form once analyze has run (AC-1)", () => {
    const alone = view({ done: ["create", "analyze"], dependsOn: [], dependsOnOptions: [] });
    expect(page(alone)).not.toContain('name="dependsOn"');
    expect(page(alone)).not.toContain("trackingform");
    expect(page(view({ done: ["create"], dependsOn: [], dependsOnOptions: [] }))).not.toContain('name="dependsOn"');
    expect(page(view({ done: ["create"], dependsOn: [], dependsOnOptions: [spec(SECOND)] }))).toContain('name="dependsOn"');
  });

  test("a dependency since archived or closed is drawn ticked, and posts like the others (AC-4)", () => {
    const html = page(withPicker({ dependsOn: [OLD, SECOND] }));
    expect(chip(html, OLD)).toMatch(/\bchecked\b/);
    expect(chip(html, OLD)).not.toMatch(/\bdisabled\b/);
    expect(chip(html, SECOND)).toMatch(/\bchecked\b/);
  });

  test("an archived or a closed spec draws no form and no Depends on field (AC-5)", () => {
    for (const record of [{ archived: true }, { archived: true, closed: true }]) {
      const html = page(withPicker(record));
      expect(html).not.toContain('name="dependsOn"');
      expect(html).not.toContain("trackingform");
    }
  });
});
