// Which of a project's suites a landing runs again. A test command that
// names its suites writes each one's result to AIDE_TEST_SUITES_REPORT
// and runs only those AIDE_TEST_ONLY_SUITES names, plus — with
// AIDE_TEST_ALSO_CHANGED_SINCE — those the changes since that commit
// need. A command that does neither runs whole, as before.

import { readFileSync, writeFileSync } from "node:fs";

/** What a red run leaves the next attempt after a repair: the suites that
 *  were red, the commit they were red on, and the main it was built on. */
export interface RedSuites { red: string[]; testedHead: string; mainSha: string }

/** The suites the report names red; `undefined` when it names none at all,
 *  which is a command that does not report and has to run whole again. */
export function redSuites(report: string): string[] | undefined {
  let text = "";
  try { text = readFileSync(report, "utf8"); } catch { return undefined; }
  const lines = text.split("\n").flatMap((line) => {
    try { const row = JSON.parse(line); return typeof row?.suite === "string" ? [row as { suite: string; ok: boolean }] : []; } catch { return []; }
  });
  return lines.length ? [...new Set(lines.filter((row) => !row.ok).map((row) => row.suite))] : undefined;
}

/** The environment one run is given: a fresh report, and the suites to
 *  run when only some are wanted. */
export function suiteEnv(report: string, only?: string[], since?: string): Record<string, string> {
  writeFileSync(report, "");
  return {
    AIDE_TEST_SUITES_REPORT: report,
    ...(only?.length ? { AIDE_TEST_ONLY_SUITES: only.join(",") } : {}),
    ...(only?.length && since ? { AIDE_TEST_ALSO_CHANGED_SINCE: since } : {}),
  };
}

/** A repaired landing reruns only some suites when main is where it was:
 *  otherwise what main brought has never run beside this change. */
export function rerunAfterRepair(previous: RedSuites | undefined, mainSha: string): RedSuites | undefined {
  return previous && previous.red.length && mainSha && previous.mainSha === mainSha ? previous : undefined;
}
