// What a merge whose suite stayed red is told, once main alone has been
// run: the tests that are the merge's own, and the sentence that names them.

import { variedBetween, type FailingTests } from "../../../format/failing-tests.ts";
import type { GateVerdict } from "../test-gate.ts";
import type { GatedJob } from "../seen-green.ts";
import { stepLogLine } from "./step-log.ts";

/** What the runs on the merge said, for the verdict after main alone. */
export interface RedFacts {
  job: GatedJob;
  branch: string;
  button: string;
  firstResult: FailingTests;
  red: string[] | undefined;
  testedHead: string;
  mainSha: string;
}

/** The failing tests a run named, kept as items for message detail. */
function namedTests(result: Pick<FailingTests, "tests" | "errors">): string[] {
  const shown = result.tests.slice(0, 8).map((test, index) => result.errors[index] ? `${test} — ${result.errors[index]}` : test);
  return result.tests.length > 8 ? [...shown, "…"] : shown;
}

/** The tests a verdict hands on, every one of them: the sentence shows eight. */
function asFailedTests(named: { test: string; file: string; error: string }[]): GateVerdict["failedTests"] {
  return named.map(({ test, file, error }) => ({ name: test, file, error }));
}

type FailedTest = { test: string; file: string; error: string };

/** The failing tests of the last run, with their files and errors. */
function failedIn(result: FailingTests): FailedTest[] {
  return result.tests.map((test, index) => ({ test, file: result.files[index] ?? "", error: result.errors[index] ?? "" }));
}

export function redOnMainVerdict({ job, branch, button }: RedFacts, onMainResult: FailingTests, lastResult: FailingTests, detail: string): GateVerdict {
  if (!onMainResult.tests.length) {
    stepLogLine(job, "the tests are red on main, but its output named no failing test", true);
    return { ok: false, error: { key: "landing.testsRedOnMainUnnamed", values: { branch, button } }, detail };
  }
  const onMain = new Set(onMainResult.tests);
  const mergeOnly = failedIn(lastResult).filter(({ test }) => !onMain.has(test));
  if (!mergeOnly.length) {
    stepLogLine(job, "the same tests are red on main as well", true);
    return { ok: false, error: { key: "landing.testsRedOnMainToo", values: { branch, button } }, detail };
  }
  const noun = mergeOnly.length === 1 ? "test is" : "tests are";
  stepLogLine(job, `the tests are red on main; ${mergeOnly.length} failing ${noun} unique to the merge`, true);
  const tests = namedTests({ tests: mergeOnly.map(({ test }) => test), errors: mergeOnly.map(({ error }) => error) });
  return {
    ok: false,
    error: { key: "landing.testsRedOnMergeToo", values: { count: mergeOnly.length, branch, button }, lists: { tests } },
    detail,
    failedTests: asFailedTests(mergeOnly),
  };
}

export function redOnMergeVerdict({ branch, button, firstResult, red, testedHead, mainSha }: RedFacts, lastResult: FailingTests, detail: string): GateVerdict {
  const firstTests = firstResult.tests;
  const lastTests = lastResult.tests;
  if (!firstTests.length) return { ok: false, error: { key: "landing.testsRedOnMergeUnnamed", values: { branch, button } }, detail };
  const firstSet = new Set(firstTests);
  const repeated = failedIn(lastResult).filter(({ test }) => firstSet.has(test));
  if (repeated.length) {
    const tests = namedTests({ tests: repeated.map(({ test }) => test), errors: repeated.map(({ error }) => error) });
    return {
      red: red?.length ? { red, testedHead, mainSha } : undefined,
      ok: false,
      error: { key: "landing.testsRedOnMerge", values: { count: repeated.length, branch, button }, lists: { tests } },
      detail,
      failedTests: asFailedTests(repeated),
    };
  }
  if (lastTests.length && variedBetween(firstTests, lastTests)) {
    const combined = new Map<string, string>();
    firstTests.forEach((test, index) => combined.set(test, firstResult.errors[index] ?? ""));
    lastTests.forEach((test, index) => combined.set(test, lastResult.errors[index] ?? ""));
    return {
      ok: false,
      error: {
        key: "landing.testsRedOnMergeVaried",
        values: { count: combined.size, branch, button },
        lists: { tests: namedTests({ tests: [...combined.keys()], errors: [...combined.values()] }) },
      },
      detail,
    };
  }
  return { ok: false, error: { key: "landing.testsRedOnMergeUnnamed", values: { branch, button } }, detail };
}
