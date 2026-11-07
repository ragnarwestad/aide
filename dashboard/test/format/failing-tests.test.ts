// The failing tests a red run names, as the recorder put them on its answer.

import { describe, expect, test } from "bun:test";
import { recordedFailures, variedBetween } from "../../src/format/failing-tests.ts";

describe("recordedFailures", () => {
  test("reads the failing tests off the recorder's last line, after the tests' own output", () => {
    const stdout = [
      "FAILED t/test_a.py::one - AssertionError: no",
      '{"ok":true,"exitCode":1,"terminalReason":"recorded","failingTests":{"tests":["t/test_a.py::one"],"files":["t/test_a.py"],"errors":["AssertionError: no"],"failed":1,"total":5}}',
    ].join("\n");
    expect(recordedFailures(stdout)).toEqual({
      tests: ["t/test_a.py::one"], files: ["t/test_a.py"], errors: ["AssertionError: no"], failed: 1, total: 5,
    });
  });

  test("a recorder that was stopped, or names none, names no test", () => {
    expect(recordedFailures("FAILED t/test_a.py::one - no\n").tests).toEqual([]);
    expect(recordedFailures('{"ok":true,"exitCode":1,"terminalReason":"recorded"}\n').tests).toEqual([]);
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
