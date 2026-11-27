// A merge red twice and green on main alone names the tests that failed,
// as red-verdict.ts decides (its rules are proven in red-verdict.test.ts);
// here the real gate is shown to hand on that verdict, and to a repair.
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { failingLines, runProjectSuiteBeforePush } from "../../../../src/serve/land-branch/test-gate.ts";
import { namingRecorder } from "../../../helpers/naming-recorder.ts";
import { gateTemps, mergedRepo } from "./gate-fixtures.ts";

const { temp } = gateTemps();

/** main, and the merge checked out on top of it carrying the spec's change. */
function merged(): string {
  return mergedRepo(temp("aide-named-failures-"));
}

/** A recorder green on main alone, and red on the merge with test_one on
 *  both runs, each with its own error. */
function recorder(): string {
  const bin = temp("aide-named-failures-bin-");
  writeFileSync(join(bin, "resolve"), `#!/bin/sh\nprintf '{"ok":true,"commands":["true"]}\\n'\n`, { mode: 0o755 });
  const runs = join(bin, "runs");
  writeFileSync(
    join(bin, "record"),
    namingRecorder(`[ -f "$2/spec-change" ] || exit 0\necho run >> ${runs}\n` +
      `if [ "$(wc -l < ${runs})" -eq 1 ]; then echo 'FAILED t/test_a.py::test_one - first error'; else echo 'FAILED t/test_a.py::test_one - second error'; fi\n` +
      `echo '{"ok":true,"exitCode":1,"terminalReason":"recorded"}'\nexit 1\n`),
    { mode: 0o755 },
  );
  process.env.AIDE_RESOLVE_TEST_CMD_BIN = join(bin, "resolve");
  process.env.AIDE_RECORD_TEST_RUN_BIN = join(bin, "record");
  process.env.AIDE_TEST_GATE_LOG = join(bin, "gate.log");
  return runs;
}

const job = { project: "aide", specFolder: "81-x" };

test("the same test on both runs is named with its latest error (AC-2)", async () => {
  recorder();
  const verdict = await runProjectSuiteBeforePush(merged(), job, "aide/81-x", { button: "Archive" });
  expect(verdict.error).toEqual({
    key: "landing.testsRedOnMerge",
    values: { count: 1, branch: "aide/81-x", button: "Archive" },
    lists: { tests: ["t/test_a.py::test_one — second error"] },
  });
}, 30_000);

describe("failingLines", () => {
  test("the recorder's own answer is not a line the tests said", () => {
    expect(failingLines('noise\n{"ok":true,"exitCode":1}\n', "")).toBe("noise");
  });

  test("a cut tail starts at a line, never inside a word", () => {
    const out = failingLines(`${"word ".repeat(30)}\nmake sure the database is reachable\n`, "", 50);
    expect(out).toBe("make sure the database is reachable");
  });
});

test("a repair sees the tested merge before cleanup and requests a fresh full gate", async () => {
  recorder();
  const seen: string[] = [];
  const verdict = await runProjectSuiteBeforePush(merged(), job, "aide/81-x", {
    button: "Archive",
    repair: async (request) => {
      seen.push(Bun.spawnSync(["git", "-C", request.root, "show", "HEAD:spec-change"]).stdout.toString().trim());
      expect(request.verdict.failedTests?.[0]?.file).toBe("t/test_a.py");
      return true;
    },
  });
  expect(seen).toEqual(["x"]);
  expect(verdict).toEqual({ ok: false, repaired: true });
});

test("a repair-capable landing does not rerun the unchanged full suite before diagnosis", async () => {
  const runs = recorder();
  const verdict = await runProjectSuiteBeforePush(merged(), job, "aide/81-x", { button: "Archive", repair: async () => false });
  expect(readFileSync(runs, "utf8").trim().split("\n")).toHaveLength(1);
  expect(verdict.ok).toBe(false);
  expect(verdict.failedTests?.[0]?.file).toBe("t/test_a.py");
});
