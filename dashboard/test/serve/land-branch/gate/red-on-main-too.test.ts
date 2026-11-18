// A landing whose tests are red twice runs them once more on the default
// branch alone, without the spec. Red there too, the failure is main's, and
// the sentence says so: a browser test broken on main stopped an archive
// as if the spec had broken it (2026-09-27).
import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectSuiteBeforePush } from "../../../../src/serve/land-branch/test-gate.ts";
import { namingRecorder } from "../../../helpers/naming-recorder.ts";

import { cancelLanding, landingProcessGroups, takeLandingCancel } from "../../../../src/serve/land-branch/cancel-landing.ts";
import { signalGroup } from "../../../../src/serve/serve-helpers/signal-group.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  delete process.env.AIDE_RESOLVE_TEST_CMD_BIN;
  delete process.env.AIDE_RECORD_TEST_RUN_BIN;
  delete process.env.AIDE_TEST_GATE_LOG;
});

function git(cwd: string, ...args: string[]): void {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
}

/** main, and the merge checked out on top of it carrying the spec's change. */
function merged(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-red-on-main-"));
  dirs.push(dir);
  writeFileSync(join(dir, "README.md"), "# p\n");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "main");
  git(dir, "switch", "-q", "-c", "merge");
  writeFileSync(join(dir, "spec-change"), "x\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "the spec");
  return dir;
}

/** A recorder red wherever `redWhen` holds for the tree it is run in. */
function recorder(redWhen: "always" | "with the spec" | "different" | "main unnamed"): void {
  const bin = mkdtempSync(join(tmpdir(), "aide-red-on-main-bin-"));
  dirs.push(bin);
  writeFileSync(join(bin, "resolve"), `#!/bin/sh\nprintf '{"ok":true,"commands":["true"]}\\n'\n`, { mode: 0o755 });
  const test = redWhen === "always" ? 'echo "(fail) a test"; exit 1'
    : redWhen === "different" ? 'if [ -f "$2/spec-change" ]; then echo "(fail) merge only"; else echo "(fail) main only"; fi; exit 1'
    : redWhen === "main unnamed" ? 'if [ -f "$2/spec-change" ]; then echo "(fail) merge only"; else echo "error: command failed"; fi; exit 1'
    : '[ -f "$2/spec-change" ] && { echo "(fail) a test"; exit 1; }; exit 0';
  writeFileSync(join(bin, "record"), namingRecorder(test), { mode: 0o755 });
  process.env.AIDE_RESOLVE_TEST_CMD_BIN = join(bin, "resolve");
  process.env.AIDE_RECORD_TEST_RUN_BIN = join(bin, "record");
  process.env.AIDE_TEST_GATE_LOG = join(bin, "gate.log");
}

const job = { project: "aide", specFolder: "81-x" };

test("red on main as well: the sentence says the failure is not the spec's", async () => {
  const root = merged();
  recorder("always");
  const verdict = await runProjectSuiteBeforePush(root, job, "aide/81-x", { button: "Archive" });
  expect(verdict.ok).toBe(false);
  expect(verdict.error).toEqual({ key: "landing.testsRedOnMainToo", values: { branch: "aide/81-x", button: "Archive" } });
}, 30_000);

test("main's result records green, red and not checked with its reason (AC-1, AC-2)", async () => {
  const root = merged();
  git(root, "branch", "-D", "main");
  recorder("with the spec");
  const verdict = await runProjectSuiteBeforePush(root, job, "aide/81-x", { button: "Archive" });
  expect(verdict.error).toEqual({
    key: "landing.testsMainNotChecked",
    values: { reason: "the default branch was not found", branch: "aide/81-x", button: "Archive" },
  });
}, 30_000);

test("when main and the merge fail different tests, the merge-only test and main outcome are recorded (AC-3, AC-4)", async () => {
  recorder("different");
  const root = merged();
  const streamFile = join(root, "different.archive.stream.jsonl");
  writeFileSync(join(root, "different.archive.run.log"), "");
  const verdict = await runProjectSuiteBeforePush(root, { ...job, streamFile, stepStartedAt: new Date().toISOString() }, "aide/81-x", { button: "Archive" });
  expect(verdict.error).toEqual({
    key: "landing.testsRedOnMergeToo",
    values: { count: 1, branch: "aide/81-x", button: "Archive" },
    lists: { tests: ["merge only"] },
  });
  expect(readFileSync(join(root, "different.archive.run.log"), "utf-8")).toContain("the tests are red on main; 1 failing test is unique to the merge");
}, 30_000);

test("an unnamed failure on red main does not make a named merge failure unique (AC-4)", async () => {
  recorder("main unnamed");
  const verdict = await runProjectSuiteBeforePush(merged(), job, "aide/81-x", { button: "Archive" });
  expect(verdict.error).toEqual({
    key: "landing.testsRedOnMainUnnamed",
    values: { branch: "aide/81-x", button: "Archive" },
  });
}, 30_000);

test("green on main: the sentence is the ordinary one, about this merge", async () => {
  const root = merged();
  recorder("with the spec");
  const verdict = await runProjectSuiteBeforePush(root, job, "aide/81-x", { button: "Archive" });
  expect(verdict.ok).toBe(false);
  expect(verdict.error).toEqual({
    key: "landing.testsRedOnMerge",
    values: { count: 1, branch: "aide/81-x", button: "Archive" },
    lists: { tests: ["a test"] },
  });
}, 30_000);

test("the tests only the merge fails are kept with their file and error (AC-1)", async () => {
  recorder("different");
  const verdict = await runProjectSuiteBeforePush(merged(), job, "aide/81-x", { button: "Archive" });
  expect(verdict.failedTests).toEqual([{ name: "merge only", file: "", error: "" }]);
}, 30_000);

test("red on main too, main unnamed and main not checked keep no list (AC-7)", async () => {
  recorder("always");
  expect((await runProjectSuiteBeforePush(merged(), job, "aide/81-x", { button: "Archive" })).failedTests).toBeUndefined();
  recorder("main unnamed");
  expect((await runProjectSuiteBeforePush(merged(), job, "aide/81-x", { button: "Archive" })).failedTests).toBeUndefined();
  const root = merged();
  git(root, "branch", "-D", "main");
  recorder("with the spec");
  expect((await runProjectSuiteBeforePush(root, job, "aide/81-x", { button: "Archive" })).failedTests).toBeUndefined();
}, 90_000);

test("Cancel stops the tests running on main after a red merge", async () => {
  const root = merged();
  recorder("always");
  const marker = join(root, "main-test-pid");
  writeFileSync(process.env.AIDE_RECORD_TEST_RUN_BIN!, namingRecorder(
    `if [ -f "$2/spec-change" ]; then echo "(fail) merge"; exit 1; fi; echo "$$" > "${marker}"; sleep 20; exit 1`
  ), { mode: 0o755 });
  const id = "cancel-main-test";
  let settled = false;
  const work = runProjectSuiteBeforePush(root, { ...job, id }, "aide/81-x", { button: "Archive" }).finally(() => { settled = true; });
  const outcome = work.then(() => undefined, (error: unknown) => error);
  let pid = 0;
  let tracked = false;
  let stopped = false;
  try {
    for (let i = 0; i < 200 && !existsSync(marker); i++) await Bun.sleep(10);
    expect(existsSync(marker)).toBe(true);
    pid = Number(readFileSync(marker, "utf8").trim());
    tracked = landingProcessGroups().includes(pid);
    cancelLanding(id);
    for (let i = 0; i < 100 && !settled; i++) await Bun.sleep(10);
    stopped = settled;
  } finally {
    if (pid > 1) signalGroup(pid, "SIGKILL");
    await outcome;
    takeLandingCancel(id);
  }
  expect(tracked).toBe(true);
  expect(stopped).toBe(true);
  expect(await outcome).toEqual(new Error("landing cancelled by user"));
}, 30_000);
