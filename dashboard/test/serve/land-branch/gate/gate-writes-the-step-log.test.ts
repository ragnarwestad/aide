// The landing's own test run is written into the step's run log, stamped
// like the runner's own lines, so the step's Log shows when the tests on
// the merge started, how they ended, and what ran again.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectSuiteBeforePush } from "../../../../src/serve/land-branch/test-gate.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  delete process.env.AIDE_RESOLVE_TEST_CMD_BIN;
  delete process.env.AIDE_RECORD_TEST_RUN_BIN;
  delete process.env.AIDE_TEST_GATE_LOG;
});

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-gate-log-"));
  dirs.push(dir);
  writeFileSync(join(dir, "README.md"), "# p\n");
  for (const args of [["init", "-q", "-b", "main"], ["config", "user.name", "T"], ["config", "user.email", "t@e.x"], ["add", "-A"], ["commit", "-qm", "main"]]) {
    Bun.spawnSync({ cmd: ["git", "-C", dir, ...args] });
  }
  return dir;
}

function scripts(recorderBody: string): void {
  const bin = mkdtempSync(join(tmpdir(), "aide-gate-log-bin-"));
  dirs.push(bin);
  writeFileSync(join(bin, "resolve"), `#!/bin/sh\nprintf '{"ok":true,"commands":["make test","make e2e"]}\\n'\n`, { mode: 0o755 });
  writeFileSync(join(bin, "record"), `#!/bin/sh\n${recorderBody}\n`, { mode: 0o755 });
  process.env.AIDE_RESOLVE_TEST_CMD_BIN = join(bin, "resolve");
  process.env.AIDE_RECORD_TEST_RUN_BIN = join(bin, "record");
  process.env.AIDE_TEST_GATE_LOG = join(bin, "gate.log");
}

/** A job as the landing is handed it: the archive step that just ran is
 *  the job's own `streamFile`, and its results still end on the implement
 *  step before it — the runner stores the archive's result after the
 *  landing has begun. */
function job(dir: string) {
  const streamFile = join(dir, "j1.archive.stream.jsonl");
  const runLog = join(dir, "j1.archive.run.log");
  const implementLog = join(dir, "j1.implement.run.log");
  writeFileSync(runLog, "aide-run-spec 10:00:00 +0s model turn started (transcript at byte 0)\n");
  writeFileSync(implementLog, "");
  return {
    runLog,
    implementLog,
    job: {
      project: "aide",
      specFolder: "81-x",
      streamFile,
      stepStartedAt: new Date().toISOString(),
      results: [{ step: "implement" as const, ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", streamFile: join(dir, "j1.implement.stream.jsonl") }],
    },
  };
}

test("a green run says when it started, with how many commands, and that it ended green", async () => {
  const root = repo();
  scripts("exit 0");
  const { job: j, runLog, implementLog } = job(root);
  await runProjectSuiteBeforePush(root, j, "aide/81-x");
  const log = readFileSync(runLog, "utf-8");
  expect(readFileSync(implementLog, "utf-8")).toBe("");
  expect(log).toMatch(/^aide-run-spec \d\d:\d\d:\d\d \+\d+s the landing runs the project's tests on the merge \(2 command\(s\)\)$/m);
  expect(log).toMatch(/^aide-run-spec \d\d:\d\d:\d\d \+\d+s the landing's tests are green$/m);
}, 30_000);

test("a red run says so as an error, and says it runs them once more", async () => {
  const root = repo();
  scripts("echo '(fail) x'\nexit 1");
  const { job: j, runLog } = job(root);
  await runProjectSuiteBeforePush(root, j, "aide/81-x");
  const log = readFileSync(runLog, "utf-8");
  expect(log).toMatch(/\+\d+s error: the landing's tests are red — running them once more$/m);
  expect(log).toMatch(/\+\d+s error: the landing's tests are red again$/m);
}, 30_000);

test("the run's progress is in the Log between its start and its end, and its whole output beside the run log", async () => {
  const root = repo();
  scripts(
    'while [ $# -gt 0 ]; do [ "$1" = --progress-file ] && p="$2"; shift; done\n' +
      'echo "running make test" >> "$p"\necho "pytest 50%" >> "$p"\necho "the whole output"\nexit 0',
  );
  const { job: j, runLog } = job(root);
  await runProjectSuiteBeforePush(root, j, "aide/81-x");
  const lines = readFileSync(runLog, "utf-8").split("\n").map((l) => l.replace(/^aide-run-spec \S+ \+\d+s /, ""));
  const start = lines.findIndex((l) => l.startsWith("the landing runs the project's tests"));
  const end = lines.indexOf("the landing's tests are green");
  expect(lines.slice(start + 1, end)).toEqual(["tests: running make test", "tests: pytest 50%"]);
  expect(readFileSync(runLog.replace(/\.run\.log$/, ".tests.log"), "utf-8")).toContain("the whole output");
}, 30_000);
