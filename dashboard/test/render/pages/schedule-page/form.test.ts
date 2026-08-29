// The shared create/edit form (spec 276). The Cron field's live-preview
// target is asserted here so Phase 6's `schedule-actions.ts` has a
// stable hook to drive (acceptance criterion 16).
import { describe, expect, test } from "bun:test";
import { CRON_NEXT_HOOK, renderScheduleForm } from "../../../../src/render/pages/schedule-page/form.ts";

describe("renderScheduleForm", () => {
  test("a blank form (create) has empty fields and a Create button", () => {
    const html = renderScheduleForm({ action: "/api/queue/schedule/aide" });
    expect(html).toContain('action="/api/queue/schedule/aide"');
    expect(html).toContain(">Create<");
    expect(html).not.toContain(">Save<");
  });

  test("a pre-filled form (edit) shows the entry's own values and a Save button", () => {
    const html = renderScheduleForm({
      entryName: "nightly",
      entry: { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md" },
      action: "/api/queue/schedule/aide/nightly",
    });
    expect(html).toContain('value="nightly"');
    expect(html).toContain('value="0 3 * * *"');
    expect(html).toContain('value="docs/nightly.md"');
    expect(html).toContain(">Save<");
  });

  test("the Cron field carries a stable live-preview hook, computed server-side as a no-script baseline", () => {
    const html = renderScheduleForm({
      entryName: "nightly",
      entry: { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md" },
      action: "/api/queue/schedule/aide/nightly",
    });
    expect(html).toContain(`data-${CRON_NEXT_HOOK}`);
    expect(html).toContain("Next run:");
  });

  test("an error is shown in the form's own slot", () => {
    const html = renderScheduleForm({ action: "/api/queue/schedule/aide", error: "a cron expression is required" });
    expect(html).toContain("a cron expression is required");
  });
});
