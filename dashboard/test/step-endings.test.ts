import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCEPTANCE_CRITERIA_UNTICKED,
  STEP_ENDINGS,
  endingMayRetry,
  isFailedEnding,
  isGuardEnding,
  isJobStop,
  isRunStop,
  leavesStepUndone,
} from "../src/step-endings.ts";
import { runSpecParts } from "./helpers/run-spec-source.ts";

const SCRIPTS = join(import.meta.dir, "../../core/scripts");

describe("the shared step-ending catalogue", () => {
  test("contains every ending emitted by the runner and archive command (AC-1)", () => {
    const files = [
      join(SCRIPTS, "aide-run-spec"),
      join(SCRIPTS, "aide-archive-spec"),
      ...runSpecParts(),
    ];
    const emitted = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      for (const match of source.matchAll(/terminal_reason="([a-z][a-z-]*)"/g)) emitted.add(match[1]!);
      for (const match of source.matchAll(/terminalReason["']?:["']([a-z][a-z-]*)["']/g)) emitted.add(match[1]!);
      for (const match of source.matchAll(/stop_(?:step|suffix) ([a-z][a-z-]*)/g)) emitted.add(match[1]!);
    }

    const catalogued = new Set(STEP_ENDINGS.map(({ name }) => name));
    expect([...emitted].filter((reason) => !catalogued.has(reason)).sort()).toEqual([]);
    expect(catalogued.size).toBe(STEP_ENDINGS.length);
  });

  test("reads every classification independently from the catalogue (AC-2)", () => {
    expect(isJobStop("tests-red")).toBe(true);
    expect(isRunStop("tests-red")).toBe(false);
    expect(isFailedEnding("tests-red")).toBe(true);
    expect(isGuardEnding(ACCEPTANCE_CRITERIA_UNTICKED)).toBe(true);
    expect(leavesStepUndone("model-at-capacity")).toBe(true);
    expect(endingMayRetry("no-progress")).toBe(true);
    expect(endingMayRetry("overlap-decision-missing")).toBe(true);
    expect(endingMayRetry("tests-not-started")).toBe(false);
  });
});
