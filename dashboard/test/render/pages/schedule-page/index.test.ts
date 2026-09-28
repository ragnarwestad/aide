import { beforeEach, describe, expect, test } from "bun:test";
import { renderSchedulePage } from "../../../../src/render";
import { clearCheckoutFaults } from "../../../../src/render/ui/checkout-faults.ts";

// The page's header shows the board's checkout faults, which live in the
// process: a board another test file started in this process can leave one.
beforeEach(() => clearCheckoutFaults());

const NAV = [{ label: "Projects", path: "/projects" }];

describe("Schedule page (spec 272, extended spec 276, reworked spec 278)", () => {
  test("?q= narrows to rows whose project:name or prompt path matches, case-insensitively (criterion 4)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      rows: [
        {
          project: "aide",
          entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
          projectScheduleHref: "/projects/aide?tab=schedule",
        },
        {
          project: "atlasaurus",
          entry: { name: "weekly-check", cron: "0 4 * * 0", prompt: "docs/weekly.md", enabled: true },
          projectScheduleHref: "/projects/atlasaurus?tab=schedule",
        },
      ],
      filter: { q: "AIDE" },
    });
    expect(html).toContain("nightly-report");
    expect(html).not.toContain("weekly-check");
  });

  test("the default view (no ?sort=) orders rows by project:name ascending (criterion 7)", () => {
    const html = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", {
      rows: [
        {
          project: "atlasaurus",
          entry: { name: "weekly-check", cron: "0 4 * * 0", prompt: "docs/weekly.md", enabled: true },
          projectScheduleHref: "/projects/atlasaurus?tab=schedule",
        },
        {
          project: "aide",
          entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
          projectScheduleHref: "/projects/aide?tab=schedule",
        },
      ],
    });
    expect(html.indexOf("aide:nightly-report")).toBeLessThan(html.indexOf("atlasaurus:weekly-check"));
  });
});
