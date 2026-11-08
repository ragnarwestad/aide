// A red implement run's sentence names tests that still fail separately
// from tests proven to pass when their files were run again alone.

import { describe, expect, test } from "bun:test";
import { testsRedMessage } from "../../../../src/queue/runner/cross-check-message.ts";
import { renderMessage } from "../../../../src/i18n/message.ts";

const said = (testsRed: unknown) =>
  testsRedMessage("implement", { terminalReason: "tests-red", testsRed });
const red = (over: Record<string, unknown> = {}) => ({
  tests: ["e2e/a.spec.ts:5 › a works", "e2e/b.spec.ts:9 › b works"],
  errors: ["expected 3, received 0", "not found"],
  failed: 2,
  total: 155,
  passedAlone: [],
  passedAloneErrors: [],
  passedAloneCount: 0,
  ...over,
});

describe("testsRedMessage", () => {
  test("says how many suite attempts ran before the tests stayed red (AC-8)", () => {
    expect(said(red({ attempts: 3 }))).toMatchObject({
      key: "runner.testsRedAfterAttempts",
      values: { attempts: "3" },
      inner: [{ key: "runner.testsRedFailing" }],
    });
    expect(renderMessage("en", said(red({ attempts: 3 })))).toContain(
      "e2e/a.spec.ts:5 › a works — expected 3, received 0",
    );
  });
  test("each failing test is followed by its own error (AC-2)", () => {
    expect(said(red())).toEqual({
      key: "runner.testsRedFailing",
      values: {
        n: "2",
        total: "155",
        tests:
          "e2e/a.spec.ts:5 › a works — expected 3, received 0; e2e/b.spec.ts:9 › b works — not found",
        button: "Implement",
      },
    });
  });

  test("a test that passed alone is the only kind called possibly unstable (AC-5)", () => {
    expect(
      said(
        red({
          passedAlone: ["e2e/c.spec.ts:3 › c works"],
          passedAloneErrors: ["timed out"],
          passedAloneCount: 1,
        }),
      ),
    ).toEqual({
      key: "runner.testsRedFailingPassedAlone",
      values: {
        n: "2",
        total: "155",
        tests:
          "e2e/a.spec.ts:5 › a works — expected 3, received 0; e2e/b.spec.ts:9 › b works — not found",
        k: "1",
        passed: "e2e/c.spec.ts:3 › c works — timed out",
        button: "Implement",
      },
    });
  });

  test("a test with no name drops only its own error, never the others'", () => {
    const withBlank = red({
      tests: ["e2e/a.spec.ts:5 › a works", "", "e2e/b.spec.ts:9 › b works"],
      errors: ["expected 3, received 0", "orphan", "not found"],
    });
    expect(said(withBlank)?.values?.tests).toBe(
      "e2e/a.spec.ts:5 › a works — expected 3, received 0; e2e/b.spec.ts:9 › b works — not found",
    );
  });

  test("an older result without errors still names its tests (AC-2)", () => {
    expect(said(red({ errors: undefined }))).toEqual({
      key: "runner.testsRedFailing",
      values: {
        n: "2",
        total: "155",
        tests: "e2e/a.spec.ts:5 › a works; e2e/b.spec.ts:9 › b works",
        button: "Implement",
      },
    });
  });

  test("when every red test passed alone, only those tests are named (AC-5)", () => {
    expect(
      said(
        red({
          tests: [],
          failed: 0,
          passedAlone: ["e2e/a.spec.ts:5 › a works"],
          passedAloneCount: 1,
        }),
      ),
    ).toEqual({
      key: "runner.testsRedPassedAlone",
      values: {
        k: "1",
        passed: "e2e/a.spec.ts:5 › a works",
        button: "Implement",
      },
    });
  });

  test("a run that printed no total names the tests with their errors (AC-2)", () => {
    const m = said(red({ total: undefined }));
    expect(m.key).toBe("runner.testsRedFailingUncounted");
    expect(m.values).toEqual({
      tests:
        "e2e/a.spec.ts:5 › a works — expected 3, received 0; e2e/b.spec.ts:9 › b works — not found",
      button: "Implement",
    });
  });

  test("more failed than are named keeps each shown error before the ellipsis (AC-2)", () => {
    expect(said(red({ failed: 12 })).values?.tests).toBe(
      "e2e/a.spec.ts:5 › a works — expected 3, received 0; e2e/b.spec.ts:9 › b works — not found; …",
    );
  });

  test.each([undefined, null, {}, { tests: [], failed: 2 }, { tests: ["a"] }])(
    "no test named (%p) keeps the sentence that says only that the tests are red",
    (raw) => {
      expect(said(raw)).toEqual({
        key: "runner.testsRedImplement",
        values: { button: "Implement" },
      });
    },
  );

  test("the reasons that hold fill the sentence with each error (AC-2)", () => {
    const text = renderMessage(
      "nb",
      said(
        red({
          passedAlone: ["e2e/c.spec.ts:3 › c works"],
          passedAloneCount: 1,
        }),
      ),
    );
    expect(text).not.toMatch(/\{\w+\}/);
    expect(text).toContain(
      "e2e/a.spec.ts:5 › a works — expected 3, received 0; e2e/b.spec.ts:9 › b works — not found",
    );
  });
});
