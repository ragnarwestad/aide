// The flag on a schedule entry naming a model the queue does not offer
// (spec 494), drawn on the Schedule list and the project's Schedule tab.
import { describe, expect, test } from "bun:test";
import { modelFlag } from "../../../../src/render/pages/schedule-page/model-flag.ts";

describe("the flag on an entry naming a model the queue does not offer (spec 494)", () => {
  const choices = ["Sonnet", "Opus"];

  test("names the model and the choices, and links to where another is chosen", () => {
    const html = modelFlag("en", "retired", choices, "/schedule/aide/nightly/edit");
    expect(html).toContain("retired");
    expect(html).toContain("Sonnet, Opus");
    expect(html).toContain('href="/schedule/aide/nightly/edit"');
  });

  test("a listed name, a case-only match and no model draw no flag", () => {
    for (const model of ["Sonnet", "sonnet", undefined]) expect(modelFlag("en", model, choices)).toBe("");
  });

  test("no model list passed draws no flag", () => {
    expect(modelFlag("en", "retired", undefined)).toBe("");
  });
});
