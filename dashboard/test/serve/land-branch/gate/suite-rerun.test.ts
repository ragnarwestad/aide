// Which suites a red landing runs again: the suites a run's report names
// red, the environment that narrows a run to them, whether a repaired
// landing may narrow at all, and the verdict that carries them to it.
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redSuites, rerunAfterRepair, suiteEnv } from "../../../../src/serve/land-branch/suite-rerun.ts";
import { redOnMergeVerdict, type RedFacts } from "../../../../src/serve/land-branch/gate/red-verdict.ts";
import { gateTemps } from "./gate-fixtures.ts";

const { temp } = gateTemps();

function report(lines: string[]): string {
  const file = join(temp("aide-suite-rerun-"), "suites.jsonl");
  writeFileSync(file, lines.join("\n"));
  return file;
}

describe("the suites a run's report names red", () => {
  test("each red suite once, and no green one", () => {
    const file = report(['{"suite":"python","ok":true}', '{"suite":"dashboard","ok":false}', '{"suite":"dashboard","ok":false}']);
    expect(redSuites(file)).toEqual(["dashboard"]);
  });

  test("a command that reports no suite has none to name, so it runs whole again", () => {
    expect(redSuites(report(["(fail) a test", ""]))).toBeUndefined();
  });
});

describe("the environment one run is given", () => {
  test("without suites named, the run is whole: a fresh report and nothing narrowing it", () => {
    const file = report(['{"suite":"python","ok":false}']);
    expect(suiteEnv(file, undefined, "abc")).toEqual({ AIDE_TEST_SUITES_REPORT: file });
    expect(readFileSync(file, "utf8")).toBe("");
  });

  test("main alone runs only the red suites", () => {
    expect(suiteEnv(report([]), ["dashboard", "python"])).toMatchObject({ AIDE_TEST_ONLY_SUITES: "dashboard,python" });
    expect(suiteEnv(report([]), ["dashboard"])).not.toHaveProperty("AIDE_TEST_ALSO_CHANGED_SINCE");
  });

  test("after a repair, the red suites and what changed since the commit they were red on", () => {
    expect(suiteEnv(report([]), ["dashboard"], "abc")).toMatchObject({ AIDE_TEST_ONLY_SUITES: "dashboard", AIDE_TEST_ALSO_CHANGED_SINCE: "abc" });
  });
});

describe("whether a repaired landing runs only some suites", () => {
  const previous = { red: ["dashboard"], testedHead: "abc", mainSha: "m1" };

  test("with main where it was, only the suites that were red", () => {
    expect(rerunAfterRepair(previous, "m1")).toEqual(previous);
  });

  test("with main moved, or nothing red to go on, the whole suite", () => {
    expect(rerunAfterRepair(previous, "m2")).toBeUndefined();
    expect(rerunAfterRepair(undefined, "m1")).toBeUndefined();
    expect(rerunAfterRepair({ ...previous, red: [] }, "m1")).toBeUndefined();
  });
});

describe("the red suites a merge's own red verdict keeps for a repair", () => {
  const failing = { tests: ["a test"], files: ["a.test.ts"], errors: [""] };
  const facts = (red: string[] | undefined): RedFacts =>
    ({ job: { project: "aide", specFolder: "81-x" }, branch: "aide/81-x", button: "Archive", firstResult: failing, red, testedHead: "abc", mainSha: "m1" });

  test("the red suites, with the commit they were red on and the main it was built on", () => {
    expect(redOnMergeVerdict(facts(["dashboard"]), failing, "").red).toEqual({ red: ["dashboard"], testedHead: "abc", mainSha: "m1" });
  });

  test("none when the run named no suite red", () => {
    expect(redOnMergeVerdict(facts(undefined), failing, "").red).toBeUndefined();
    expect(redOnMergeVerdict(facts([]), failing, "").red).toBeUndefined();
  });
});
