// A red implement run's sentence names its failing tests and says what
// they point at: the change, or unstable tests and a busy machine, read
// from the step result's `testsRed` (run-spec/turn/failing-tests.sh).

import { describe, expect, test } from "bun:test";
import { testsRedMessage } from "../../../../src/queue/runner/cross-check-message.ts";
import { renderMessage } from "../../../../src/i18n/message.ts";

const said = (testsRed: unknown) => testsRedMessage("implement", { terminalReason: "tests-red", testsRed });
const red = (over: Record<string, unknown> = {}) => ({
  tests: ["e2e/a.spec.ts:5 › a works", "e2e/b.spec.ts:9 › b works"],
  failed: 2,
  total: 155,
  touched: true,
  untouched: 0,
  variedBetweenRuns: false,
  ...over,
});

describe("testsRedMessage", () => {
  test("tests in files the change touched, failing the same each run, point at the change", () => {
    expect(said(red())).toEqual({
      key: "runner.testsRedInChange",
      values: { n: "2", total: "155", tests: "e2e/a.spec.ts:5 › a works; e2e/b.spec.ts:9 › b works", button: "Implement" },
    });
  });

  test("a failing test in a touched file beside others outside it still points at the change", () => {
    expect(said(red({ untouched: 1 })).key).toBe("runner.testsRedInChange");
  });

  test("none in a touched file points away from the change, saying how many are outside it", () => {
    expect(said(red({ touched: false, untouched: 2 }))).toEqual({
      key: "runner.testsRedUnsteady",
      values: { n: "2", total: "155", tests: "e2e/a.spec.ts:5 › a works; e2e/b.spec.ts:9 › b works", button: "Implement" },
      inner: { key: "runner.testsRedUntouched", values: { k: "2", n: "2" } },
    });
  });

  test("runs that failed different tests point away from the change, and say only what is true", () => {
    expect(said(red({ variedBetweenRuns: true })).inner).toEqual({ key: "runner.testsRedVaried" });
    expect(said(red({ variedBetweenRuns: true, untouched: 1 })).inner).toEqual({
      key: "runner.testsRedVariedUntouched",
      values: { k: "1", n: "2" },
    });
  });

  test("tests with no file to compare and the same each run point at the change", () => {
    expect(said(red({ touched: false, untouched: 0 })).key).toBe("runner.testsRedInChange");
  });

  test("a run that printed no total names the tests without one", () => {
    const m = said(red({ total: undefined }));
    expect(m.key).toBe("runner.testsRedInChangeUncounted");
    expect(m.values).toEqual({ tests: "e2e/a.spec.ts:5 › a works; e2e/b.spec.ts:9 › b works", button: "Implement" });
  });

  test("more failed than are named says there are more", () => {
    expect(said(red({ failed: 12 })).values?.tests).toBe("e2e/a.spec.ts:5 › a works; e2e/b.spec.ts:9 › b works; …");
  });

  test.each([undefined, null, {}, { tests: [], failed: 2 }, { tests: ["a"] }])(
    "no test named (%p) keeps the sentence that says only that the tests are red",
    (raw) => {
      expect(said(raw)).toEqual({ key: "runner.testsRedImplement", values: { button: "Implement" } });
    },
  );

  test("the reasons that hold fill the sentence, with no blank left", () => {
    const text = renderMessage("nb", said(red({ touched: false, untouched: 2, variedBetweenRuns: true })));
    expect(text).not.toMatch(/\{\w+\}/);
    expect(text).toContain("e2e/a.spec.ts:5 › a works; e2e/b.spec.ts:9 › b works");
  });
});
