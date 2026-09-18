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

  // Spec 484, AC-5: the same English-leak guard, for the three languages
  // added beside English and Norwegian.
  test.each(["es", "de", "fr"] as const)("the detail list is not the English words in %s", (lang) => {
    const html = renderScheduleOverview(
      "aide",
      { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true, model: "codex-fast" },
      { lang },
    );
    expect(html).not.toContain("<dt>Next run</dt>");
    expect(html).not.toContain("<dt>Prompt file</dt>");
    expect(html).not.toContain("<dt>Model</dt>");
    expect(html).not.toContain("<dd>yes</dd>");
  });
});

describe("the flag on an entry naming a model the queue does not offer (spec 494)", () => {
  const entry = { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true };
  const choices = [{ name: "Sonnet" }, { name: "Opus" }];

  test("names the model and the choices, without a link", () => {
    const html = renderScheduleOverview("aide", { ...entry, model: "retired" }, { modelChoices: choices });
    expect(html).toContain("retired");
    expect(html).toContain("Sonnet, Opus");
    expect(html).toContain("rowmsg failed");
    expect(html).not.toContain("<a href=\"/schedule/aide/nightly\"");
  });

  test("a listed name, a case-only match and no model draw no flag", () => {
    for (const model of ["Sonnet", "sonnet", undefined]) {
      expect(renderScheduleOverview("aide", { ...entry, model }, { modelChoices: choices })).not.toContain("is not one the queue offers");
    }
  });

  test("a queue that offers no models gets the no-models sentence", () => {
    const html = renderScheduleOverview("aide", { ...entry, model: "retired" }, { modelChoices: [] });
    expect(html).toContain("it offers no models");
  });

  test("no model list passed draws no flag", () => {
    expect(renderScheduleOverview("aide", { ...entry, model: "retired" }, {})).not.toContain("is not one the queue offers");
  });
});
