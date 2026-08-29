import { describe, expect, test } from "bun:test";
import { renderSchedulePage } from "../../../src/render.ts";

const NAV = [{ label: "Projects", path: "/projects" }];

describe("Schedule page (spec 272)", () => {
  test("given rows from two projects, both appear", () => {
    const html = renderSchedulePage(NAV, "2026-08-29T00:00:00Z", {
      rows: [
        {
          project: "aide",
          entry: { name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md" },
          lastState: "done",
          outputHref: "/schedule-output/aide/schedule-nightly-report/index.html",
        },
        {
          project: "atlasaurus",
          entry: { name: "traffic-analysis", cron: "0 0 * * *", prompt: "docs/traffic.md" },
          lastState: undefined,
          outputHref: undefined,
        },
      ],
    });
    expect(html).toContain("aide");
    expect(html).toContain("nightly-report");
    expect(html).toContain("0 3 * * *");
    expect(html).toContain("atlasaurus");
    expect(html).toContain("traffic-analysis");
    expect(html).toContain("0 0 * * *");
  });

  test("given zero rows, the none-yet message appears and the page still renders", () => {
    const html = renderSchedulePage(NAV, "2026-08-29T00:00:00Z", { rows: [] });
    expect(html.toLowerCase()).toContain("no project has a schedule entry yet");
    expect(html).toContain("<html");
  });
});
