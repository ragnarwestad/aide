import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { Job } from "../../../../src/queue/types.ts";
import { renderScheduleDetailPage, renderSchedulePage } from "../../../../src/render";
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

/** Each heading of a page's table as [its text, its link, its `aria-sort`]. */
function headings(html: string, table = "table.list"): [string, string | null, string | null][] {
  const window = new Window();
  window.document.body.innerHTML = html;
  return [...window.document.querySelectorAll(`${table} thead th`)].map((th) => [
    th.textContent ?? "",
    th.querySelector("a")?.getAttribute("href") ?? null,
    th.getAttribute("aria-sort"),
  ]);
}

describe("the /schedule list's sortable headings", () => {
  const rows = [
    {
      project: "aide",
      entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
      projectScheduleHref: "/projects/aide?tab=schedule",
    },
  ];

  test("link to each column, the sorted one turned round, and mark the sorted one (AC-5)", () => {
    expect(headings(renderSchedulePage(NAV, "2026-08-30T00:00:00Z", { rows }))).toEqual([
      ["Name", "/schedule?sort=name&dir=desc", "ascending"],
      ["Next run", "/schedule?sort=next", null],
      ["Last run", "/schedule?sort=last", null],
      ["Enabled", null, null],
    ]);
    const sorted = renderSchedulePage(NAV, "2026-08-30T00:00:00Z", { rows, filter: { q: "night", sort: "next", dir: "desc" } });
    expect(headings(sorted)).toEqual([
      ["Name", "/schedule?q=night&sort=name", null],
      ["Next run", "/schedule?q=night&sort=next", "descending"],
      ["Last run", "/schedule?q=night&sort=last", null],
      ["Enabled", null, null],
    ]);
  });
});

describe("the entry's Report tab", () => {
  const run = {
    id: "r1", project: "aide", specFolder: "schedule-nightly-report", steps: ["schedule"], stepIndex: 0, state: "done",
    timeoutSec: {}, permissionMode: {}, model: {}, createdAt: "2026-09-01T03:00:00Z", startedAt: "2026-09-01T03:00:00Z",
  } as unknown as Job;

  test("draws the runs list after the report panel it was handed (AC-2)", () => {
    const html = renderScheduleDetailPage(NAV, "2026-09-30T00:00:00Z", {
      project: "aide",
      entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
      runs: [run],
      shownRun: "r1",
      reportPanel: `<section id="report">REPORT</section><section id="proposals">PROPOSALS</section>`,
    });
    const window = new Window();
    window.document.body.innerHTML = html;
    const doc = window.document;
    const runs = doc.getElementById("runs");
    expect(runs).not.toBeNull();
    for (const before of ["report", "proposals"]) {
      expect(doc.getElementById(before)!.compareDocumentPosition(runs!) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});
