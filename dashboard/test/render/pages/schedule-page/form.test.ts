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

  test("a `projects` option renders a Project select with one option per project (spec 278, criterion 12)", () => {
    const html = renderScheduleForm({ action: "/api/queue/schedule", projects: ["aide", "atlasaurus"] });
    expect(html).toContain('<select name="project">');
    expect(html).toContain('<option value="aide">aide</option>');
    expect(html).toContain('<option value="atlasaurus">atlasaurus</option>');
  });

  // The model pair. One picker for the whole entry, not one per phase:
  // a scheduled job is a single `schedule` step.
  const TWO_TOOLS = [
    { name: "claude-opus-5", budgetUsd: 15 },
    { name: "codex-fast", budgetUsd: 5, tool: "codex" as const },
  ];

  test("the model select offers every configured model, grouped by tool", () => {
    const html = renderScheduleForm({ action: "/api/queue/schedule", modelChoices: TWO_TOOLS });
    expect(html).toContain('<select name="model"');
    expect(html).toContain('value="claude-opus-5"');
    expect(html).toContain('value="codex-fast"');
    expect(html).toContain("<optgroup label=\"Claude Code\">");
    expect(html).toContain("<optgroup label=\"Codex\">");
  });

  test("exactly ONE model select — there are no phases here to pick per", () => {
    const html = renderScheduleForm({ action: "/api/queue/schedule", modelChoices: TWO_TOOLS });
    expect(html.match(/<select name="model"/g)).toHaveLength(1);
    expect(html).not.toContain('name="model.');
  });

  test("editing pre-fills the select with the entry's OWN model, not the configured default", () => {
    const html = renderScheduleForm({
      entryName: "nightly",
      entry: { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", model: "codex-fast" },
      action: "/api/queue/schedule/aide/nightly",
      modelChoices: TWO_TOOLS,
      defaultModels: { schedule: "claude-opus-5" },
    });
    expect(html).toContain('value="codex-fast" data-tool="codex" title="$5 per step" selected');
    expect(html).not.toContain('value="claude-opus-5" data-tool="claude" title="$15 per step" selected');
  });

  test("an entry with no model of its own pre-fills with the schedule step's configured default", () => {
    const html = renderScheduleForm({
      entryName: "nightly",
      entry: { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md" },
      action: "/api/queue/schedule/aide/nightly",
      modelChoices: TWO_TOOLS,
      defaultModels: { schedule: "codex-fast" },
    });
    expect(html).toContain('value="codex-fast" data-tool="codex" title="$5 per step" selected');
  });

  test("the AI select is drawn only where there are two tools to tell apart", () => {
    const two = renderScheduleForm({ action: "/api/queue/schedule", modelChoices: TWO_TOOLS });
    expect(two).toContain('data-ai="model"');
    expect(two).toContain('data-default="codex-fast"');
    const one = renderScheduleForm({
      action: "/api/queue/schedule",
      modelChoices: [{ name: "claude-opus-5", budgetUsd: 15 }],
    });
    expect(one).not.toContain("data-ai=");
    expect(one).toContain('<select name="model"');
  });

  test("the model row sits under Cron and above the submit button", () => {
    const html = renderScheduleForm({ action: "/api/queue/schedule", modelChoices: TWO_TOOLS });
    expect(html.indexOf('name="cron"')).toBeLessThan(html.indexOf('<select name="model"'));
    expect(html.indexOf('<select name="model"')).toBeLessThan(html.indexOf(">Create<"));
  });

  test("a dashboard with no models configured draws no picker at all", () => {
    const html = renderScheduleForm({ action: "/api/queue/schedule" });
    expect(html).not.toContain('<select name="model"');
    expect(html).not.toContain("data-ai=");
  });

  test("omitting `projects` renders no Project select (the Edit form never passes it)", () => {
    const html = renderScheduleForm({
      entryName: "nightly",
      entry: { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md" },
      action: "/api/queue/schedule/aide/nightly",
    });
    expect(html).not.toContain('<select name="project">');
  });
});
