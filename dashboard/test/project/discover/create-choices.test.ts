// The four choices the New spec form's Options tab makes, read off a
// description's Tracking info with the default a spec with nothing
// recorded runs with.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChoicesIn } from "../../../src/project/discover";

const REPO = join(import.meta.dir, "..", "..", "..", "..");

const description = (...lines: string[]): string =>
  ["# A spec - Description", "", "## Tracking info", "", "- **Created:** `2026-10-10 11:11 UTC`", ...lines, "", "---", ""].join("\n");

describe("createChoicesIn", () => {
  test("a description with none of the lines reads as the defaults (AC-7)", () => {
    expect(createChoicesIn(description())).toEqual({
      acceptanceRequired: true,
      aiFormulate: true,
      criteriaChecks: "off",
      chooseApproach: false,
    });
  });

  test("each recorded value is read back (AC-5)", () => {
    const text = description(
      "- **Acceptance:** not required",
      "- **Let AI formulate acceptance criteria:** no",
      "- **Acceptance criteria checks:** warn",
      "- **Let me choose the approach:** yes",
    );
    expect(createChoicesIn(text)).toEqual({
      acceptanceRequired: false,
      aiFormulate: false,
      criteriaChecks: "warn",
      chooseApproach: true,
    });
  });

  test("only `no` turns the AI formulation off (AC-7)", () => {
    expect(createChoicesIn(description("- **Let AI formulate acceptance criteria:** yes")).aiFormulate).toBe(true);
    expect(createChoicesIn(description("- **Let AI formulate acceptance criteria:** maybe")).aiFormulate).toBe(true);
    expect(createChoicesIn(description("- **Let AI formulate acceptance criteria:** no")).aiFormulate).toBe(false);
  });

  test("the level is read as the runner reads it, for every case of the shared table (AC-7)", () => {
    const cases = JSON.parse(readFileSync(join(REPO, "core", "tests", "fixtures", "criteria-checks-level.json"), "utf-8")).cases as {
      name: string; description: string | null; level: string;
    }[];
    for (const c of cases) {
      const text = description(...(c.description === null ? [] : [`- **Acceptance criteria checks:** ${c.description}`]));
      expect([c.name, createChoicesIn(text).criteriaChecks as string]).toEqual([c.name, c.level]);
    }
  });
});
