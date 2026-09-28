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
});
