// Spec 394: what belongs to the whole spec sits above the tabs — the
// depends-on picker and the acceptance switch, drawn together in the
// banner rather than the Description tab's own form, on every tab.

import { describe, expect, test } from "bun:test";
import { page, view } from "./spec-page-fixtures.ts";

describe("spec 394: the banner's combined tracking control", () => {
  // REQ-1: the depends-on picker sits above the tab row, on every tab —
  // not just the Description one it used to belong to.
  test("REQ-1: the depends-on picker is drawn on the Checks tab too, not only Description", () => {
    const html = page(view({ dependsOnOptions: [{ project: "aide", specFolder: "80-earlier" }] }), "checks");
    expect(html).toContain("Depends on");
    expect(html).toContain('name="dependsOn"');
  });

  // REQ-4: the fact is shown once — inside the control, no separate
  // read-only echo of it beside the control that sets it.
  test("REQ-4: a set dependency appears once, inside the control, no read-only echo", () => {
    const html = page(
      view({
        dependsOn: ["80-earlier"],
        dependsOnOptions: [{ project: "aide", specFolder: "80-earlier" }],
      }),
    );
    // The identifier appears as the one ticked box's own value/data-
    // attribute/label — never a SECOND time as a read-only "Depends
    // on: 80-earlier" sentence beside the control that sets it.
    expect(html).toMatch(new RegExp(`value="80-earlier"[^>]*checked`));
    expect(html).not.toMatch(/<strong>Depends on<\/strong>/);
  });

  // REQ-2: the acceptance switch sits in the same banner area.
  test("REQ-2: the acceptance switch is drawn in the banner, editable by default", () => {
    const html = page(view());
    expect(html).toContain('name="acceptanceNotRequired"');
    expect(html).toContain('name="acceptanceEditable"');
  });

  // REQ-6: locked, not omitted, once analyze has run — with a title
  // saying why, the same disabled-with-reason shape pdfControl/
  // resetControl already use.
  test("REQ-6: the switch is drawn disabled with a title once done includes analyze", () => {
    const html = page(view({ done: ["create", "analyze"] }));
    expect(html).not.toContain('name="acceptanceNotRequired"');
    expect(html).toMatch(/aria-disabled="true" title="analyze has already decided/);
    expect(html).toContain("acceptance ticking not required");
  });

  // REQ-6's own criterion is testable both ways: nothing done yet draws
  // the live control.
  test("no analyze yet draws the live, editable switch", () => {
    const html = page(view({ done: [] }));
    expect(html).toMatch(/<input type="checkbox" name="acceptanceNotRequired"/);
  });

  test("the switch reflects the spec's own recorded choice", () => {
    const checked = page(view({ acceptanceNotRequired: true }));
    expect(checked).toMatch(/name="acceptanceNotRequired" value="1" checked/);
    const unchecked = page(view({ acceptanceNotRequired: false }));
    expect(unchecked).not.toMatch(/name="acceptanceNotRequired" value="1" checked/);
  });

  // REQ-7: an archived spec keeps the read-only shape it always had —
  // no form at all, since a save on a record would write into archive/.
  test("REQ-7: an archived spec draws read-only prose, no tracking form", () => {
    const html = page(view({ archived: true, dependsOn: ["80-earlier"], acceptanceNotRequired: true }));
    expect(html).not.toContain('action="/api/queue/specs/aide/150-one-page-shows-the-whole-spec/tracking"');
    expect(html).toContain("80-earlier");
    expect(html).toContain("not required");
  });
});
