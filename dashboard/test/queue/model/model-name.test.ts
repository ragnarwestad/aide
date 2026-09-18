import { describe, expect, test } from "bun:test";
import { listedModelName } from "../../../src/queue/model-name.ts";

describe("listedModelName", () => {
  test("an exact match wins over a case-only match", () => {
    expect(listedModelName(["sonnet", "Sonnet"], "sonnet")).toEqual({ name: "sonnet" });
  });

  test("one case-only match resolves to the listed spelling", () => {
    expect(listedModelName(["Sonnet", "Opus"], "sonnet")).toEqual({ name: "Sonnet" });
  });

  test("several case-only matches come back as candidates", () => {
    expect(listedModelName(["Sonnet", "SONNET"], "sonnet")).toEqual({ candidates: ["Sonnet", "SONNET"] });
  });

  test("no match gives empty candidates", () => {
    expect(listedModelName(["Sonnet"], "haiku")).toEqual({ candidates: [] });
  });
});
