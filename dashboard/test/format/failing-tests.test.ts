// The failing tests a red run names, read from its own output.
// `failing_tests` (core/scripts/lib/run-spec/turn/failing-tests.sh) reads
// a step's own run the same way, and core/tests/fixtures/failing-tests.json
// pins both.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { failingTests, variedBetween } from "../../src/format/failing-tests.ts";

const CASES = JSON.parse(readFileSync(join(import.meta.dir, "../../../core/tests/fixtures/failing-tests.json"), "utf-8"))
  .cases as { name: string; log: string[]; tests: string[]; files: string[]; errors: string[]; failed?: number; total?: number }[];

describe("failingTests", () => {
  test.each(CASES)("$name (AC-1, AC-4)", ({ log, tests, files, errors, failed, total }) => {
    const got = failingTests(`${log.join("\n")}\n`);
    expect(got.tests).toEqual(tests);
    expect(got.files).toEqual(files);
    expect(got.errors).toEqual(errors);
    expect(got.failed).toBe(failed);
    expect(got.total).toBe(total);
  });
});

describe("variedBetween", () => {
  test("a test that fails now and did not before is a varied run", () => {
    expect(variedBetween(["a", "b"], ["b", "c"])).toBe(true);
  });

  test("a second run that failed some of the same tests and no new one is not", () => {
    expect(variedBetween(["a", "b"], ["b"])).toBe(false);
    expect(variedBetween(["a", "b"], ["b", "a"])).toBe(false);
  });
});
