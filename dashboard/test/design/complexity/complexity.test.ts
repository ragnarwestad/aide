// The function and repeated-block checks over the dashboard's own
// TypeScript, under src/ and test/ alike. Code over a threshold is held
// at the level recorded in held.json and fails only when it gets worse;
// the thresholds and their reasons are in measure.ts and in the root
// AGENTS.md, "Code health".
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tsFilesUnder } from "../source-files.ts";
import { duplicateFailures, duplicates, functionFailures, type Measure, tsFunctions } from "./measure.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const HELD = JSON.parse(readFileSync(join(import.meta.dir, "held.json"), "utf-8")) as {
  functions: Record<string, Partial<Measure>>;
  duplicates: Record<string, number>;
};

describe("dashboard complexity", () => {
  const files: Record<string, string> = {};
  for (const file of [...tsFilesUnder(join(ROOT, "src")), ...tsFilesUnder(join(ROOT, "test"))]) {
    files[file.slice(ROOT.length + 1)] = readFileSync(file, "utf-8");
  }

  test("the scan reads the files under src and under test (AC-3)", () => {
    expect(Object.keys(files)).toContain("src/job-states.ts");
    expect(Object.keys(files)).toContain("test/design/complexity/complexity.test.ts");
  });

  test("no function is longer or deeper than its limit or its held level (AC-3)", () => {
    const measured: Record<string, Measure> = {};
    for (const [rel, text] of Object.entries(files)) {
      for (const [name, value] of Object.entries(tsFunctions(text))) measured[`${rel}::${name}`] = value;
    }
    expect(functionFailures(measured, HELD.functions)).toEqual([]);
  });

  test("no file repeats more blocks than its held level (AC-3)", () => {
    expect(duplicateFailures(duplicates(files), HELD.duplicates)).toEqual([]);
  });
});
