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

  // Spec 482: the whole `<dl>` and the AI/Model fields in the Edit form
  // below it were English string literals, never routed through `t()`.
  test("the detail list reads Norwegian, not English", () => {
    const html = renderScheduleOverview(
      "aide",
      { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true, model: "codex-fast" },
      { lang: "nb" },
    );
    expect(html).toContain("<dt>Neste kjøring</dt>");
    expect(html).toContain("<dt>Promptfil</dt>");
    expect(html).toContain("<dt>Modell</dt>");
    expect(html).toContain("<dt>Aktivert</dt><dd>ja</dd>");
    expect(html).not.toContain("<dt>Next run</dt>");
    expect(html).not.toContain("<dt>Prompt file</dt>");
    expect(html).not.toContain("<dt>Model</dt>");
    expect(html).not.toContain("<dd>yes</dd>");
  });
});
