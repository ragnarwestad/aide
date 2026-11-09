// A hand-paired bash/TypeScript decision (docs/bash-typescript-decisions.md):
// which archive refusals are guards rather than attempts, and so are
// left out of a phase's attempt count on both sides — the file's own
// `Attempts:` stamp (aide-run-spec) and the row's count (the dashboard).
// Nothing imports across the two.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { STEP_ENDINGS, isGuardEnding } from "../../src/step-endings.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const OUTCOME_SH = read("../../../core/scripts/lib/run-spec/record/outcome.sh");
const PHASE_ROWS = read("../../src/render/pages/specs-list/phase-rows.ts");

const GUARDS = STEP_ENDINGS.filter(({ guard }) => guard).map(({ name }) => name);

describe("a guard refusal is not an attempt, on either side", () => {
  test("aide-run-spec leaves the stamp alone for exactly these reasons", () => {
    expect(OUTCOME_SH).toContain('step_ending_has "$terminal_reason" guard');
    expect(GUARDS.sort()).toEqual(["acceptance-criteria-unticked", "not-implemented-yet"]);
  });

  test("the dashboard leaves the same reasons out of its count", () => {
    expect(PHASE_ROWS).toContain("isGuardEnding(stepResultOf");
    expect(GUARDS.every(isGuardEnding)).toBe(true);
  });
});
