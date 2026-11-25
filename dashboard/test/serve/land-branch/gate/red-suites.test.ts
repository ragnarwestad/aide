// A landing whose suite is red runs only the red suites on main alone, and
// after a repair only those and the ones the repair's own changes need —
// unless main has moved, when the whole suite runs again.
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runProjectSuiteBeforePush } from "../../../../src/serve/land-branch/test-gate.ts";
import { namingRecorder } from "../../../helpers/naming-recorder.ts";
import { gateTemps, git, mergedRepo } from "./gate-fixtures.ts";

const { temp } = gateTemps();

function merged(): string {
  return mergedRepo(temp("aide-red-suites-"));
}

/** A project command with two suites: python green, dashboard red with the
 *  spec. Each run's choice of suites is written to the file it returns. */
function recorder(): string {
  const bin = temp("aide-red-suites-bin-");
  const runs = join(bin, "runs");
  writeFileSync(join(bin, "resolve"), `#!/bin/sh\nprintf '{"ok":true,"commands":["true"]}\\n'\n`, { mode: 0o755 });
  writeFileSync(join(bin, "record"), namingRecorder(
    `echo "\${AIDE_TEST_ONLY_SUITES:-all}|\${AIDE_TEST_ALSO_CHANGED_SINCE:-}" >> "${runs}"
echo '{"suite":"python","ok":true}' >> "$AIDE_TEST_SUITES_REPORT"
if [ -f "$2/spec-change" ]; then echo '{"suite":"dashboard","ok":false}' >> "$AIDE_TEST_SUITES_REPORT"; echo "(fail) a test"; exit 1; fi
echo '{"suite":"dashboard","ok":true}' >> "$AIDE_TEST_SUITES_REPORT"; exit 0`), { mode: 0o755 });
  process.env.AIDE_RESOLVE_TEST_CMD_BIN = join(bin, "resolve");
  process.env.AIDE_RECORD_TEST_RUN_BIN = join(bin, "record");
  process.env.AIDE_TEST_GATE_LOG = join(bin, "gate.log");
  return runs;
}

const job = { project: "aide", specFolder: "81-x" };
const runs = (file: string) => readFileSync(file, "utf8").trim().split("\n");

test("main alone runs only the suites that were red, and the verdict keeps them for a repair", async () => {
  const root = merged();
  const log = recorder();
  const verdict = await runProjectSuiteBeforePush(root, job, "aide/81-x", { button: "Archive", repair: async () => false });
  expect((verdict.error as { key: string }).key).toBe("landing.testsRedOnMerge");
  expect(runs(log)).toEqual(["all|", "dashboard|"]);
  expect(verdict.red).toEqual({ red: ["dashboard"], testedHead: git(root, "rev-parse", "HEAD").trim(), mainSha: git(root, "rev-parse", "main").trim() });
}, 30_000);

test("after a repair, with main where it was, only the red suites and the repair's own run; with main moved, all", async () => {
  const root = merged();
  const log = recorder();
  const mainSha = git(root, "rev-parse", "main").trim();
  await runProjectSuiteBeforePush(root, job, "aide/81-x", { button: "Archive", red: { red: ["dashboard"], testedHead: "abc", mainSha } });
  expect(runs(log)[0]).toBe("dashboard|abc");
  writeFileSync(log, "");
  await runProjectSuiteBeforePush(root, job, "aide/81-x", { button: "Archive", red: { red: ["dashboard"], testedHead: "abc", mainSha: "elsewhere" } });
  expect(runs(log)[0]).toBe("all|");
}, 30_000);
