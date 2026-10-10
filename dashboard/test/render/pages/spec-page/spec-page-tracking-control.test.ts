// Spec 394: what belongs to the whole spec sits above the tabs — the
// depends-on picker and the acceptance switch, drawn together in the
// banner rather than the Description tab's own form, on every tab.

import { describe, expect, test } from "bun:test";
import { page, view } from "../spec-page-fixtures.ts";

describe("spec 394: the banner's combined tracking control", () => {
  // REQ-6: locked, not omitted, once analyze has run — with a "(?)"
  // saying why, the same disabled-with-reason shape pdfControl/
  // resetControl already use (spec 454: moved off `title` into a
  // helpPopover).
  test("REQ-6: the switch is drawn disabled with a '(?)' once done includes analyze", () => {
    const html = page(view({ done: ["create", "analyze"] }));
    expect(html).not.toContain('name="acceptanceRequired"');
    expect(html).toMatch(/<span class="row" aria-disabled="true">/);
    expect(html).not.toMatch(/title="analyze has already decided/);
    expect(html).toContain(
      "<p>Analyze has already decided whether to write the acceptance-criteria table — this cannot change now.</p>",
    );
    // Still a box, and still saying which way it went — it used to draw
    // one sentence for both answers.
    expect(html).toContain("acceptance ticking required");
    expect(html).toMatch(/<input type="checkbox" disabled/);
  });

  // REQ-6's own criterion is testable both ways: nothing done yet draws
  // the live control.
  test("no analyze yet draws the live, editable switch", () => {
    const html = page(view({ done: [] }));
    expect(html).toMatch(/<input type="checkbox" name="acceptanceRequired"/);
  });

  // Spec 627: the three choices made on New spec's Options tab sit beside
  // the acceptance switch, shown as chosen and not changeable.
  const CHOICES = { acceptanceRequired: true, aiFormulate: false, criteriaChecks: "warn", chooseApproach: true } as const;
  const disabledTags = (html: string) => html.match(/<(?:input|select)\b[^>]*\bdisabled\b[^>]*>/g) ?? [];

  test("a live spec shows the three choices as chosen, beside the switch (AC-5)", () => {
    const html = page(view({ createChoices: CHOICES }));
    expect(html).toContain("Let AI formulate acceptance criteria");
    expect(html).toContain("Acceptance criteria checks");
    expect(html).toContain("Let me choose the approach");
    expect(html).toMatch(/<input type="checkbox" name="acceptanceRequired"/);
    // AI formulation not ticked, the approach ticked: two disabled boxes, one of them checked.
    const boxes = disabledTags(html).filter((tag) => tag.startsWith("<input"));
    expect(boxes).toHaveLength(2);
    expect(boxes.filter((tag) => /\bchecked\b/.test(tag))).toHaveLength(1);
    expect(html).toMatch(/<select[^>]*\bdisabled\b[^>]*>[\s\S]*?<option value="warn" selected>/);
  });

  test("the three choices carry no field name, so the banner's form posts none of them (AC-6)", () => {
    const html = page(view({ createChoices: CHOICES }));
    const tags = disabledTags(html);
    expect(tags.length).toBeGreaterThanOrEqual(3);
    for (const tag of tags) expect(tag).not.toContain("name=");
  });

  test("an archived spec shows the three choices as facts with the same values (AC-5)", () => {
    const html = page(view({ archived: true, createChoices: CHOICES }));
    expect(html).toContain("Let AI formulate acceptance criteria");
    expect(html).toContain("Acceptance criteria checks");
    expect(html).toContain("Let me choose the approach");
    expect(html).toContain("Warn");
    expect(disabledTags(html)).toEqual([]);
  });

  test("a view with no recorded choices shows the defaults (AC-7)", () => {
    const html = page(view({ createChoices: { acceptanceRequired: true, aiFormulate: true, criteriaChecks: "off", chooseApproach: false } }));
    const boxes = disabledTags(html).filter((tag) => tag.startsWith("<input"));
    expect(boxes.filter((tag) => /\bchecked\b/.test(tag))).toHaveLength(1);
    expect(html).toMatch(/<select[^>]*\bdisabled\b[^>]*>[\s\S]*?<option value="off" selected>/);
  });
});
