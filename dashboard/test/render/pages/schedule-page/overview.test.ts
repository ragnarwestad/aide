import { describe, expect, test } from "bun:test";
import { renderScheduleOverview } from "../../../../src/render/pages/schedule-page/overview.ts";

describe("renderScheduleOverview", () => {
  test("shows the cron, the computed next run and the prompt path", () => {
    const html = renderScheduleOverview(
      "aide",
      { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
      {},
    );
    expect(html).toContain("0 3 * * *");
    expect(html).toContain("docs/nightly.md");
    expect(html).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test("includes an inline Edit form pre-filled with the entry's own values, posting to this entry's own path", () => {
    const html = renderScheduleOverview(
      "aide",
      { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
      {},
    );
    expect(html).toContain('action="/api/queue/schedule/aide/nightly"');
    expect(html).toContain('value="nightly"');
  });
});
