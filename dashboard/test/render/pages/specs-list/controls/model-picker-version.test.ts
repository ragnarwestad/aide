// A model picker's options always name a version: what the alias gives
// today while the select is a choice, and what the phase actually ran on
// once it is a record. A cancelled run left the select a choice, and the
// version dropped off it ("Opus 5.5" became "Opus").

import { describe, expect, test } from "bun:test";
import { pickerModels, recordLabel, resolveRecordedModel, sidePickers } from "../../../../../src/render/pages/specs-list/model-picker.ts";
import type { SpecGroup } from "../../../../../src/render/pages/specs-list/data-model";

const MODELS = [
  { name: "Opus", ranAs: "claude-opus-5-5" },
  { name: "Sonnet", ranAs: "claude-sonnet-5-5" },
];

describe("pickerModels", () => {
  test("a choice keeps what each alias gives today, a phase run before included", () => {
    expect(pickerModels(MODELS, "Opus", false, undefined)).toEqual(MODELS);
  });

  test("a record names what the phase ran on for the chosen model", () => {
    const shown = pickerModels(MODELS, "Opus", true, "claude-opus-5-1");
    expect(shown.find((m) => m.name === "Opus")?.ranAs).toBe("claude-opus-5-1");
    expect(shown.find((m) => m.name === "Sonnet")?.ranAs).toBe("claude-sonnet-5-5");
  });

  test("a record with no id of its own falls back to what the alias gives today", () => {
    expect(pickerModels(MODELS, "Opus", true, undefined)).toEqual(MODELS);
  });
});

describe("a phase's recorded model", () => {
  // Phases once recorded `claude opus`; the choice is `Opus`, and the
  // picker took the lowercase word for a model since removed.
  test("finds its choice whatever the case", () => {
    expect(resolveRecordedModel([{ name: "Opus" }, { name: "Sonnet" }], undefined, "opus")).toBe("Opus");
  });

  test("finds a choice named by its id", () => {
    const pinned = { name: "Opus 4.8", named: { id: "claude-opus-4-8", name: "Opus 4.8" } };
    expect(resolveRecordedModel([{ name: "Opus" }, pinned], undefined, "claude-opus-4-8")).toBe("Opus 4.8");
  });

  test("a model no choice names any more is still named by the version it ran on", () => {
    expect(recordLabel("opus-old", "claude-opus-5-5")).toBe("Opus 5.5");
    expect(recordLabel("opus-old", undefined)).toBe("opus-old");
  });
});

describe("the Review and Verify pickers", () => {
  const g = { project: "aide", specFolder: "1-x", named: true } as SpecGroup;
  const opts = { modelChoices: MODELS, defaultModels: { review: "Opus" } };

  test("name the version the alias gives today, as a phase's picker does", () => {
    expect(sidePickers(g, opts, "review", false)).toContain(">Opus 5.5<");
  });

  test("name the version the session ran on once it has run", () => {
    expect(sidePickers(g, opts, "review", true, "claude-opus-5-1")).toContain(">Opus 5.1<");
  });
});
