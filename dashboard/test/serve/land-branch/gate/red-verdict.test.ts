// Which tests a red merge is told are its own, once main alone has run:
// green on main, only tests both runs on the merge failed are the merge's;
// red on main, only tests main does not fail are.
import { describe, expect, test } from "bun:test";
import type { FailingTests } from "../../../../src/format/failing-tests.ts";
import { redOnMainVerdict, redOnMergeVerdict, type RedFacts } from "../../../../src/serve/land-branch/gate/red-verdict.ts";

/** A run that failed `tests`, each in `t/<test>.py` with `<test> error <run>`. */
function run(tests: string[], label: string): FailingTests {
  return { tests, files: tests.map((t) => `t/${t}.py`), errors: tests.map((t) => `${t} error ${label}`) };
}

const NONE = run([], "");

function facts(firstResult: FailingTests, red?: string[]): RedFacts {
  return {
    job: { project: "aide", specFolder: "81-x" },
    branch: "aide/81-x",
    button: "Archive",
    firstResult,
    red,
    testedHead: "head",
    mainSha: "main",
  };
}

const values = { branch: "aide/81-x", button: "Archive" };

describe("green on main: redOnMergeVerdict", () => {
  test("a first run that named no test claims no repeated failure, whatever the second named", () => {
    const verdict = redOnMergeVerdict(facts(NONE), run(["one"], "2"), "detail");
    expect(verdict).toEqual({ ok: false, error: { key: "landing.testsRedOnMergeUnnamed", values }, detail: "detail" });
  });

  test("the same test on both runs is the merge's, named with its latest error and file", () => {
    const verdict = redOnMergeVerdict(facts(run(["one"], "1")), run(["one"], "2"), "detail");
    expect(verdict.error).toEqual({
      key: "landing.testsRedOnMerge",
      values: { count: 1, ...values },
      lists: { tests: ["one — one error 2"] },
    });
    expect(verdict.failedTests).toEqual([{ name: "one", file: "t/one.py", error: "one error 2" }]);
  });

  test("only a test both runs failed counts, when either run also failed another", () => {
    const verdict = redOnMergeVerdict(facts(run(["two", "one"], "1")), run(["one", "three"], "2"), "detail");
    expect(verdict.error).toMatchObject({ key: "landing.testsRedOnMerge", values: { count: 1 }, lists: { tests: ["one — one error 2"] } });
    expect(verdict.failedTests?.map((t) => t.name)).toEqual(["one"]);
  });

  test("every repeated failure is counted and handed on, though the list shows eight", () => {
    const names = Array.from({ length: 10 }, (_, i) => `test_${i + 1}`);
    const verdict = redOnMergeVerdict(facts(run(names, "1")), run(names, "2"), "detail");
    expect(verdict.error).toMatchObject({ key: "landing.testsRedOnMerge", values: { count: 10 } });
    const shown = (verdict.error as { lists?: { tests?: string[] } }).lists?.tests;
    expect(shown).toHaveLength(9);
    expect(shown?.at(-1)).toBe("…");
    expect(verdict.failedTests).toHaveLength(10);
    expect(verdict.failedTests?.[9]).toEqual({ name: "test_10", file: "t/test_10.py", error: "test_10 error 2" });
  });

  test("different tests on the two runs are listed apart, each with the error its own run gave, and none is handed on", () => {
    const verdict = redOnMergeVerdict(facts(run(["one"], "1")), run(["two"], "2"), "detail");
    expect(verdict.error).toEqual({
      key: "landing.testsRedOnMergeVaried",
      values: { count: 2, ...values },
      lists: { tests: ["one — one error 1", "two — two error 2"] },
    });
    expect(verdict.failedTests).toBeUndefined();
  });

  test("a second run that named no test after a named first is unnamed", () => {
    const verdict = redOnMergeVerdict(facts(run(["one"], "1")), NONE, "detail");
    expect(verdict).toEqual({ ok: false, error: { key: "landing.testsRedOnMergeUnnamed", values }, detail: "detail" });
  });

  test("a repeated failure carries the red suites with the tested head and main, and only when some were red", () => {
    const withRed = redOnMergeVerdict(facts(run(["one"], "1"), ["dashboard"]), run(["one"], "2"), "detail");
    expect(withRed.red).toEqual({ red: ["dashboard"], testedHead: "head", mainSha: "main" });
    const withoutRed = redOnMergeVerdict(facts(run(["one"], "1"), []), run(["one"], "2"), "detail");
    expect(withoutRed.red).toBeUndefined();
  });
});

describe("red on main: redOnMainVerdict", () => {
  test("main that named no failing test makes no merge failure unique", () => {
    const verdict = redOnMainVerdict(facts(run(["one"], "1")), NONE, run(["one"], "2"), "detail");
    expect(verdict).toEqual({ ok: false, error: { key: "landing.testsRedOnMainUnnamed", values }, detail: "detail" });
  });

  test("every merge failure also failing on main is main's, and none is handed on", () => {
    const verdict = redOnMainVerdict(facts(run(["one"], "1")), run(["one", "two"], "main"), run(["one"], "2"), "detail");
    expect(verdict).toEqual({ ok: false, error: { key: "landing.testsRedOnMainToo", values }, detail: "detail" });
  });

  test("the tests only the merge fails are counted, listed and handed on with file and error", () => {
    const verdict = redOnMainVerdict(facts(run(["one"], "1")), run(["one"], "main"), run(["one", "two"], "2"), "detail");
    expect(verdict.error).toEqual({
      key: "landing.testsRedOnMergeToo",
      values: { count: 1, ...values },
      lists: { tests: ["two — two error 2"] },
    });
    expect(verdict.failedTests).toEqual([{ name: "two", file: "t/two.py", error: "two error 2" }]);
  });
});
