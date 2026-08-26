// Spec 247: `parsePhaseOutcome` reads the per-phase outcome record spec
// 245's writer puts into each phase's own file — the same altitude
// `parse-status.test.ts` uses for `parseStepModels`, its closest sibling.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePhaseOutcome, specPhaseOutcome } from "../../src/project/parse-phase-outcome.ts";

const withTracking = (...lines: string[]) =>
  ["# 247 - Analysis", "", "## Tracking info", "", ...lines, "", "## Findings", ""].join("\n");

describe("parsePhaseOutcome", () => {
  test("a recorded model comes back (criterion 6, 7)", () => {
    expect(parsePhaseOutcome(withTracking("- **Model:** claude claude-sonnet-5")).model).toBe(
      "claude claude-sonnet-5",
    );
  });

  test("no Model line means no model", () => {
    expect(parsePhaseOutcome(withTracking("- **Result:** completed")).model).toBeUndefined();
  });

  test("a Time spent line becomes milliseconds (criterion 1)", () => {
    expect(parsePhaseOutcome(withTracking("- **Time spent:** 5m32s")).timeSpentMs).toBe(332_000);
  });

  test("a Time spent line past an hour still parses (over-60 minutes case)", () => {
    expect(parsePhaseOutcome(withTracking("- **Time spent:** 75m00s")).timeSpentMs).toBe(4_500_000);
  });

  test("no Time spent line means no figure (criterion 2)", () => {
    expect(parsePhaseOutcome(withTracking("- **Result:** completed")).timeSpentMs).toBeUndefined();
  });

  test("a Cost line becomes a dollar figure, unmeasured unset (criterion 3)", () => {
    const outcome = parsePhaseOutcome(withTracking("- **Cost:** $0.0123"));
    expect(outcome.cost).toBe(0.0123);
    expect(outcome.costUnmeasured).toBeUndefined();
  });

  test("a Cost line marked (unmeasured) carries the flag (criterion 4)", () => {
    const outcome = parsePhaseOutcome(withTracking("- **Cost:** $0.0123 (unmeasured)"));
    expect(outcome.cost).toBe(0.0123);
    expect(outcome.costUnmeasured).toBe(true);
  });

  test("no Cost line at all means no figure, never 0 (criterion 5)", () => {
    expect(parsePhaseOutcome(withTracking("- **Result:** completed")).cost).toBeUndefined();
  });

  test("a look-alike bullet outside Tracking info is ignored (criterion 8)", () => {
    const content = [
      "# 247 - Analysis",
      "",
      "## Tracking info",
      "",
      "- **Result:** completed",
      "",
      "## Risk analysis",
      "",
      "- **Cost:** high",
      "",
    ].join("\n");
    expect(parsePhaseOutcome(content).cost).toBeUndefined();
  });

  test("no Tracking info section at all yields nothing", () => {
    expect(parsePhaseOutcome("# 247 - Analysis\n\nProse only.\n")).toEqual({});
  });
});

describe("specPhaseOutcome", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aide-phase-outcome-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const write = (name: string, content: string) => writeFileSync(join(dir, name), content);

  test("create reads 1-description.md", () => {
    write("1-description.md", withTracking("- **Result:** completed", "- **Time spent:** 1m00s"));
    expect(specPhaseOutcome(dir, "create").timeSpentMs).toBe(60_000);
  });

  test("analyze reads 2-analysis.md", () => {
    write("2-analysis.md", withTracking("- **Cost:** $1.5000"));
    expect(specPhaseOutcome(dir, "analyze").cost).toBe(1.5);
  });

  test("implement reads 3-solution.md", () => {
    write("3-solution.md", withTracking("- **Model:** claude sonnet"));
    expect(specPhaseOutcome(dir, "implement").model).toBe("claude sonnet");
  });

  test("archive reads 4-status.md", () => {
    write("4-status.md", withTracking("- **Time spent:** 2m00s"));
    expect(specPhaseOutcome(dir, "archive").timeSpentMs).toBe(120_000);
  });

  test("an unknown step reads nothing", () => {
    expect(specPhaseOutcome(dir, "review-plan")).toEqual({});
  });

  test("a file that does not exist yet reads nothing", () => {
    const empty = mkdtempSync(join(tmpdir(), "aide-phase-outcome-empty-"));
    expect(specPhaseOutcome(empty, "create")).toEqual({});
    rmSync(empty, { recursive: true, force: true });
  });
});
