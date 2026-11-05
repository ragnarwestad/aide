// A red implement run's sentence names tests that still fail separately
// from tests proven to pass when their files were run again alone.

import { describe, expect, test } from "bun:test";
import { testsRedMessage } from "../../../../src/queue/runner/cross-check-message.ts";
import { renderMessage } from "../../../../src/i18n/message.ts";

const said = (testsRed: unknown) => testsRedMessage("implement", { terminalReason: "tests-red", testsRed });
const red = (over: Record<string, unknown> = {}) => ({
  tests: ["e2e/a.spec.ts:5 › a works", "e2e/b.spec.ts:9 › b works"],
  failed: 2,
  total: 155,
  passedAlone: [],
  passedAloneCount: 0,
  ...over,
});

describe("testsRedMessage", () => {
  test("tests that still fail are stated without an unstable-test claim (AC-4, AC-6)", () => {
    expect(said(red())).toEqual({
      key: "runner.testsRedFailing",
      values: { n: "2", total: "155", tests: "e2e/a.spec.ts:5 › a works; e2e/b.spec.ts:9 › b works", button: "Implement" },
    });
  });

  test("a test that passed alone is the only kind called possibly unstable (AC-5)", () => {
    expect(said(red({ passedAlone: ["e2e/c.spec.ts:3 › c works"], passedAloneCount: 1 }))).toEqual({
      key: "runner.testsRedFailingPassedAlone",
      values: { n: "2", total: "155", tests: "e2e/a.spec.ts:5 › a works; e2e/b.spec.ts:9 › b works", k: "1", passed: "e2e/c.spec.ts:3 › c works", button: "Implement" },
    });
  });

  test("when every red test passed alone, only those tests are named (AC-5)", () => {
    expect(said(red({ tests: [], failed: 0, passedAlone: ["e2e/a.spec.ts:5 › a works"], passedAloneCount: 1 }))).toEqual({
      key: "runner.testsRedPassedAlone",
      values: { k: "1", passed: "e2e/a.spec.ts:5 › a works", button: "Implement" },
    });
  });

  test("a run that printed no total names the tests without one", () => {
    const m = said(red({ total: undefined }));
    expect(m.key).toBe("runner.testsRedFailingUncounted");
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
    const text = renderMessage("nb", said(red({ passedAlone: ["e2e/c.spec.ts:3 › c works"], passedAloneCount: 1 })));
    expect(text).not.toMatch(/\{\w+\}/);
    expect(text).toContain("e2e/a.spec.ts:5 › a works; e2e/b.spec.ts:9 › b works");
  });
});
