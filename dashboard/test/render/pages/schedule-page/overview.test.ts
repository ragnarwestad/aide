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

  test("states the entry's own model, and states none where the entry names none", () => {
    const entry = { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true };
    expect(renderScheduleOverview("aide", { ...entry, model: "codex-fast" }, {})).toContain("<dt>Model</dt>");
    expect(renderScheduleOverview("aide", entry, {})).not.toContain("<dt>Model</dt>");
  });

  test("includes a Delete link to the entry's own delete confirmation page (spec 277, acceptance criterion 7)", () => {
    const html = renderScheduleOverview(
      "aide",
      { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
      {},
    );
    expect(html).toContain('href="/schedule/aide/nightly/delete"');
  });
});
