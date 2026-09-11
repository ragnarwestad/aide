// A hand-paired bash/TypeScript decision (docs/bash-typescript-decisions.md):
// which archive refusals are guards rather than attempts, and so are
// left out of a phase's attempt count on both sides — the file's own
// `Attempts:` stamp (aide-run-spec) and the row's count (the dashboard).
// Nothing imports across the two.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const OUTCOME_SH = read("../../../core/scripts/lib/run-spec-outcome.sh");
const PHASE_ROWS = read("../../src/render/pages/queue-list/phase-rows.ts");

const GUARDS = ["not-implemented-yet", "acceptance-criteria-unticked"];

describe("a guard refusal is not an attempt, on either side", () => {
  test("aide-run-spec leaves the stamp alone for exactly these reasons", () => {
    const arm = /case "\$terminal_reason" in\s*\n\s*([^)]+)\) attempts_display=\$\{prior_attempts:-0\}/.exec(OUTCOME_SH)?.[1] ?? "";
    expect(arm.split("|").map((s) => s.trim()).sort()).toEqual([...GUARDS].sort());
  });

  test("the dashboard leaves the same reasons out of its count", () => {
    const set = /const GUARD_REFUSALS = new Set\(\[([^\]]*)\]\)/.exec(PHASE_ROWS)?.[1] ?? "";
    const names = [...set.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).sort();
    expect(names).toEqual([...GUARDS].sort());
  });
});
